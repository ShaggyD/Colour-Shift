/* Colour Shift — a GNOME Shell extension.
 *
 * Applies a full-screen GLSL colour transform to the whole desktop
 * (every application, every monitor) by attaching a Shell.GLSLEffect to
 * Main.layoutManager.uiGroup, which contains global.window_group.
 *
 * Two effect types are available:
 *   - ColorShiftEffect: a plain 3x3 colour matrix (channel isolation, tints)
 *   - CrtEffect:        a CRT emulation (scanlines, shadow mask, phosphor
 *                       bloom, centre glass glow, edge vignette, curvature)
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';
import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';

// Rec.709 luminance weights: turn a colour image into a single-channel image
// (monochrome) so detail is preserved.
const LUMA = [0.2126, 0.7152, 0.0722];
const scale = (v, f) => v.map(x => x * f);

/*
 * Presets.
 *   kind 'matrix' -> 3x3 colour matrix, row-major, applied by ColorShiftEffect
 *   kind 'crt'    -> CRT emulation, tint is the phosphor colour
 */
const PRESETS = [
    {id: 'red',        kind: 'matrix', label: 'Red only',         rows: [[1, 0, 0], [0, 0, 0], [0, 0, 0]]},
    {id: 'green',      kind: 'matrix', label: 'Green only',       rows: [[0, 0, 0], [0, 1, 0], [0, 0, 0]]},
    {id: 'blue',       kind: 'matrix', label: 'Blue only',        rows: [[0, 0, 0], [0, 0, 0], [0, 0, 1]]},
    {id: 'red-mono',   kind: 'matrix', label: 'Red monochrome',   rows: [LUMA, [0, 0, 0], [0, 0, 0]]},
    {id: 'green-mono', kind: 'matrix', label: 'Green monochrome', rows: [[0, 0, 0], LUMA, [0, 0, 0]]},
    {id: 'amber',      kind: 'matrix', label: 'Amber',            rows: [LUMA, scale(LUMA, 0.65), [0, 0, 0]]},
    {id: 'sepia',      kind: 'matrix', label: 'Sepia',            rows: [[0.393, 0.769, 0.189], [0.349, 0.686, 0.168], [0.272, 0.534, 0.131]]},
    {id: 'grayscale',  kind: 'matrix', label: 'Grayscale',        rows: [LUMA, LUMA, LUMA]},
    {id: 'crt-amber',  kind: 'crt',    label: 'CRT Amber',        tint: [1.00, 0.72, 0.35]},
    {id: 'crt-green',  kind: 'crt',    label: 'CRT Green',        tint: [0.45, 1.00, 0.50]},
];

function presetById(id) {
    return PRESETS.find(p => p.id === id) ?? PRESETS[0];
}

/* ------------------------------------------------------------------ *
 * Matrix effect (colour presets)
 * ------------------------------------------------------------------ */

const ColorShiftEffect = GObject.registerClass(
class ColorShiftEffect extends Shell.GLSLEffect {
    _init(params = {}) {
        super._init(params);
        this._rowRLoc = this.get_uniform_location('cs_row_r');
        this._rowGLoc = this.get_uniform_location('cs_row_g');
        this._rowBLoc = this.get_uniform_location('cs_row_b');
        this.setRows(PRESETS[0].rows);
    }

    vfunc_build_pipeline() {
        const decl = `
            uniform vec3 cs_row_r;
            uniform vec3 cs_row_g;
            uniform vec3 cs_row_b;
        `;
        const src = `
            vec3 cs_in = cogl_color_out.rgb;
            cogl_color_out.rgb = vec3(
                dot(cs_row_r, cs_in),
                dot(cs_row_g, cs_in),
                dot(cs_row_b, cs_in));
        `;
        this.add_glsl_snippet(Cogl.SnippetHook.FRAGMENT, decl, src, false);
    }

    setRows(rows) {
        this.set_uniform_float(this._rowRLoc, 3, rows[0]);
        this.set_uniform_float(this._rowGLoc, 3, rows[1]);
        this.set_uniform_float(this._rowBLoc, 3, rows[2]);
        this.queue_repaint();
    }
});

/* ------------------------------------------------------------------ *
 * CRT effect
 *
 * Single fragment pass:
 *   barrel distortion -> sample + multi-tap phosphor bloom -> amber tint
 *   -> scanlines -> shadow mask -> centre glow -> edge vignette
 * ------------------------------------------------------------------ */

const CRT_DEFAULTS = {
    texSize: [1920, 1080],
    scanline: 0.35,
    mask: 0.30,
    bloom: 0.45,
    glow: 0.30,
    vignette: 0.25,
    curvature: 0.06,
    strength: 1.0,
    tint: [1.0, 0.72, 0.35],
    tintAmount: 0.80,
};

const CrtEffect = GObject.registerClass(
class CrtEffect extends Shell.GLSLEffect {
    _init(params = {}) {
        super._init(params);
        this._u = {
            texSize:    this.get_uniform_location('cs_tex_size'),
            scanline:   this.get_uniform_location('cs_scanline'),
            mask:       this.get_uniform_location('cs_mask'),
            bloom:      this.get_uniform_location('cs_bloom'),
            glow:       this.get_uniform_location('cs_glow'),
            vignette:   this.get_uniform_location('cs_vignette'),
            curvature:  this.get_uniform_location('cs_curvature'),
            strength:   this.get_uniform_location('cs_strength'),
            tint:       this.get_uniform_location('cs_tint'),
            tintAmount: this.get_uniform_location('cs_tint_amount'),
        };
        this._params = {...CRT_DEFAULTS};
        this._flush();
    }

    vfunc_build_pipeline() {
        const decl = `
            uniform vec2  cs_tex_size;
            uniform float cs_scanline;
            uniform float cs_mask;
            uniform float cs_bloom;
            uniform float cs_glow;
            uniform float cs_vignette;
            uniform float cs_curvature;
            uniform float cs_strength;
            uniform vec3  cs_tint;
            uniform float cs_tint_amount;
            // Declare our own sampler: Cogl binds this effect's offscreen
            // source texture to texture unit 0 when it draws, so a declared
            // sampler defaults to it (same trick the shell's FadeEffect uses).
            uniform sampler2D cs_source;
            vec3 cs_sample (vec2 uv) {
                return texture2D (cs_source, clamp (uv, 0.0, 1.0)).rgb;
            }
        `;
        const src = `
            cogl_color_out = cogl_color_in * texture2D (cs_source, vec2 (cogl_tex_coord_in[0].xy));
            vec2 cs_uv = cogl_tex_coord_in[0].xy;
            vec2 cs_c  = cs_uv - 0.5;
            float cs_r2 = dot (cs_c, cs_c);
            vec2 cs_wuv = cs_uv + cs_c * (cs_r2 * cs_curvature);
            vec3 cs_col;
            if (cs_wuv.x < 0.0 || cs_wuv.x > 1.0 || cs_wuv.y < 0.0 || cs_wuv.y > 1.0) {
                cs_col = vec3 (0.0);
            } else {
                vec2 cs_step = 1.0 / cs_tex_size;
                vec3 cs_base = cs_sample (cs_wuv);
                vec3 cs_bl = vec3 (0.0);
                cs_bl += cs_sample (cs_wuv + cs_step * vec2 ( 1.0,  0.0)) * 0.12;
                cs_bl += cs_sample (cs_wuv + cs_step * vec2 (-1.0,  0.0)) * 0.12;
                cs_bl += cs_sample (cs_wuv + cs_step * vec2 ( 0.0,  1.0)) * 0.12;
                cs_bl += cs_sample (cs_wuv + cs_step * vec2 ( 0.0, -1.0)) * 0.12;
                cs_bl += cs_sample (cs_wuv + cs_step * vec2 ( 2.0,  0.0)) * 0.07;
                cs_bl += cs_sample (cs_wuv + cs_step * vec2 (-2.0,  0.0)) * 0.07;
                cs_bl += cs_sample (cs_wuv + cs_step * vec2 ( 0.0,  2.0)) * 0.07;
                cs_bl += cs_sample (cs_wuv + cs_step * vec2 ( 0.0, -2.0)) * 0.07;
                cs_col = cs_base + cs_bl * cs_bloom * 2.0;
                float cs_lum = dot (cs_col, vec3 (0.2126, 0.7152, 0.0722));
                cs_col = mix (cs_col, vec3 (cs_lum) * cs_tint, cs_tint_amount);
                float cs_scan = 0.5 + 0.5 * cos (cs_wuv.y * cs_tex_size.y * 6.2831853);
                cs_col *= mix (1.0, cs_scan, cs_scanline);
                float cs_mx = mod (gl_FragCoord.x, 3.0);
                vec3 cs_maskv = vec3 (0.55);
                if (cs_mx < 1.0) cs_maskv.r = 1.0;
                else if (cs_mx < 2.0) cs_maskv.g = 1.0;
                else cs_maskv.b = 1.0;
                cs_col *= mix (vec3 (1.0), cs_maskv, cs_mask);
                float cs_rad = length (cs_uv - 0.5) * 1.41421356;
                cs_col += cs_col * cs_glow * (1.0 - smoothstep (0.0, 0.75, cs_rad));
                cs_col *= 1.0 - cs_vignette * smoothstep (0.45, 1.0, cs_rad);
            }
            cogl_color_out.rgb = mix (cogl_color_out.rgb, cs_col, cs_strength);
        `;
        this.add_glsl_snippet(Cogl.SnippetHook.FRAGMENT, decl, src, true);
    }

    setParams(params) {
        this._params = {...this._params, ...params};
        this._flush();
    }

    _flush() {
        const p = this._params;
        this.set_uniform_float(this._u.texSize, 2, p.texSize);
        this.set_uniform_float(this._u.scanline, 1, [p.scanline]);
        this.set_uniform_float(this._u.mask, 1, [p.mask]);
        this.set_uniform_float(this._u.bloom, 1, [p.bloom]);
        this.set_uniform_float(this._u.glow, 1, [p.glow]);
        this.set_uniform_float(this._u.vignette, 1, [p.vignette]);
        this.set_uniform_float(this._u.curvature, 1, [p.curvature]);
        this.set_uniform_float(this._u.strength, 1, [p.strength]);
        this.set_uniform_float(this._u.tint, 3, p.tint);
        this.set_uniform_float(this._u.tintAmount, 1, [p.tintAmount]);
        this.queue_repaint();
    }
});

/* ------------------------------------------------------------------ *
 * A labelled slider row for the dropdown menu
 * ------------------------------------------------------------------ */

const SliderRow = GObject.registerClass({
    Properties: {
        'value': GObject.ParamSpec.double(
            'value', null, null,
            GObject.ParamFlags.READWRITE,
            0.0, 1.0, 0.0),
    },
}, class SliderRow extends PopupMenu.PopupBaseMenuItem {
    _init(label, value) {
        super._init({activate: false});
        this.add_style_class_name('colorshift-slider-item');

        this._updating = false;
        this._slider = new Slider(value);
        this._slider.accessible_name = label;
        this._slider.connect('notify::value', () => {
            if (!this._updating)
                this.notify('value');
        });

        const box = new St.BoxLayout({vertical: true, x_expand: true});
        box.add_child(new St.Label({
            text: label,
            style_class: 'colorshift-slider-label',
        }));
        box.add_child(this._slider);
        this.add_child(box);
    }

    get value() {
        return this._slider.value;
    }

    set value(v) {
        if (this._slider.value === v)
            return;
        this._updating = true;
        this._slider.value = v;
        this._updating = false;
    }

    vfunc_key_press_event(event) {
        const key = event.get_key_symbol();
        if (key === Clutter.KEY_Left || key === Clutter.KEY_Right)
            return this._slider.vfunc_key_press_event(event);
        return super.vfunc_key_press_event(event);
    }
});

/* ------------------------------------------------------------------ *
 * Quick Settings tile + panel indicator
 * ------------------------------------------------------------------ */

const ColorShiftIndicator = GObject.registerClass(
class ColorShiftIndicator extends QuickSettings.SystemIndicator {
    _init(extension) {
        super._init();

        this._extension = extension;
        this._settings = extension.getSettings();

        // Panel (top bar) icon — visible only when active.
        this._indicator = this._addIndicator();
        this._indicator.icon_name = 'night-light-symbolic';
        this._indicator.visible = false;

        // The Quick Settings tile: main body toggles, arrow opens the menu.
        this._toggle = new QuickSettings.QuickMenuToggle({
            title: 'Colour Shift',
            icon_name: 'night-light-symbolic',
            toggle_mode: true,
            menu_enabled: true,
        });
        this._toggle.menu.setHeader('night-light-symbolic',
            'Colour Shift', 'Choose a mode');

        // Colour presets live in a submenu so the dropdown fits small screens.
        this._items = new Map();
        const colourMenu = new PopupMenu.PopupSubMenuMenuItem('Colour');
        this._toggle.menu.addMenuItem(colourMenu);
        for (const preset of PRESETS.filter(p => p.kind === 'matrix')) {
            const item = new PopupMenu.PopupMenuItem(preset.label);
            item.connect('activate', () => {
                this._settings.set_string('preset', preset.id);
                this._settings.set_boolean('enabled', true);
            });
            this._items.set(preset.id, item);
            colourMenu.menu.addMenuItem(item);
        }

        // CRT modes and their tuning live in one submenu.
        this._crtMenu = new PopupMenu.PopupSubMenuMenuItem('CRT');
        this._toggle.menu.addMenuItem(this._crtMenu);
        for (const preset of PRESETS.filter(p => p.kind === 'crt')) {
            const item = new PopupMenu.PopupMenuItem(preset.label);
            item.connect('activate', () => {
                this._settings.set_string('preset', preset.id);
                this._settings.set_boolean('enabled', true);
            });
            this._items.set(preset.id, item);
            this._crtMenu.menu.addMenuItem(item);
        }
        this._crtMenu.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._crtSliders = new Map();
        const slider = (key, label) => {
            const row = new SliderRow(label, this._settings.get_double(key));
            row.connect('notify::value',
                () => this._settings.set_double(key, row.value));
            this._crtSliders.set(key, row);
            this._crtMenu.menu.addMenuItem(row);
        };
        slider('crt-scanline', 'Scanlines');
        slider('crt-mask', 'Shadow mask');
        slider('crt-bloom', 'Phosphor glow');
        slider('crt-glow', 'Glass glow');
        slider('crt-vignette', 'Edge vignette');

        this._curvatureItem = new PopupMenu.PopupSwitchMenuItem(
            'Curvature', this._settings.get_boolean('crt-curvature'));
        this._curvatureItem.connect('toggled',
            (item, state) => this._settings.set_boolean('crt-curvature', state));
        this._crtMenu.menu.addMenuItem(this._curvatureItem);

        // Clicking the tile itself toggles on/off.
        this._toggle.connect('clicked', () => {
            this._settings.set_boolean('enabled', this._toggle.checked);
        });

        // Persisted state can come from anywhere (this UI or gsettings CLI).
        this._settings.connectObject('changed', () => this._sync(), this);

        this.quickSettingsItems.push(this._toggle);
        this._sync();
    }

    _sync() {
        const enabled = this._settings.get_boolean('enabled');
        const preset = presetById(this._settings.get_string('preset'));

        this._toggle.checked = enabled;
        this._toggle.subtitle = enabled ? preset.label : '';
        this._indicator.visible = enabled;

        for (const [id, item] of this._items) {
            item.setOrnament(id === preset.id
                ? PopupMenu.Ornament.DOT
                : PopupMenu.Ornament.NO_DOT);
        }

        for (const [key, row] of this._crtSliders)
            row.value = this._settings.get_double(key);
        this._curvatureItem.state = this._settings.get_boolean('crt-curvature');

        this._extension.applyPreset(enabled ? preset : null);
    }

    destroy() {
        this._settings?.disconnectObject(this);
        this.quickSettingsItems?.forEach(item => item.destroy());
        this.quickSettingsItems = [];
        super.destroy();
    }
});

/* ------------------------------------------------------------------ *
 * Extension
 * ------------------------------------------------------------------ */

export default class ColorShiftExtension extends Extension {
    enable() {
        this._settings = this.getSettings();

        // Both effects are created once and left attached; we flip their
        // `enabled` flag (the same pattern the shell uses for its own
        // desaturate / brightness effects on uiGroup).
        this._matrixEffect = new ColorShiftEffect({name: 'colorshift'});
        this._matrixEffect.enabled = false;
        Main.layoutManager.uiGroup.add_effect(this._matrixEffect);

        this._crtEffect = new CrtEffect({name: 'colorshift-crt'});
        this._crtEffect.enabled = false;
        Main.layoutManager.uiGroup.add_effect(this._crtEffect);

        this._indicator = new ColorShiftIndicator(this);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);

        // Keep the CRT texel size in sync with the screen layout.
        this._monitorsId = Main.layoutManager.connect('monitors-changed',
            () => this._indicator?._sync());
    }

    disable() {
        if (this._monitorsId) {
            Main.layoutManager.disconnect(this._monitorsId);
            this._monitorsId = 0;
        }

        this._indicator?.destroy();
        this._indicator = null;

        for (const eff of [this._matrixEffect, this._crtEffect]) {
            if (eff) {
                Main.layoutManager.uiGroup?.remove_effect(eff);
            }
        }
        this._matrixEffect = null;
        this._crtEffect = null;
        this._settings = null;
    }

    /** @param {?object} preset a preset from PRESETS, or null to switch off */
    applyPreset(preset) {
        if (!this._matrixEffect || !this._crtEffect)
            return;

        if (!preset) {
            this._matrixEffect.enabled = false;
            this._crtEffect.enabled = false;
            return;
        }

        if (preset.kind === 'crt') {
            this._matrixEffect.enabled = false;
            this._applyCrtParams(preset);
            this._crtEffect.enabled = true;
        } else {
            this._crtEffect.enabled = false;
            this._matrixEffect.setRows(preset.rows);
            this._matrixEffect.enabled = true;
        }
    }

    _applyCrtParams(preset) {
        const s = this._settings;
        const ui = Main.layoutManager.uiGroup;
        const w = Math.max(1, Math.round(ui?.width || global.stage.width));
        const h = Math.max(1, Math.round(ui?.height || global.stage.height));

        this._crtEffect.setParams({
            texSize: [w, h],
            scanline: s.get_double('crt-scanline'),
            mask: s.get_double('crt-mask'),
            bloom: s.get_double('crt-bloom'),
            glow: s.get_double('crt-glow'),
            vignette: s.get_double('crt-vignette'),
            curvature: s.get_boolean('crt-curvature')
                ? s.get_double('crt-curvature-amount') : 0.0,
            tint: preset.tint,
            tintAmount: s.get_double('crt-tint-amount'),
            strength: 1.0,
        });
    }
}
