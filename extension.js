/* Colour Shift — a GNOME Shell extension.
 *
 * Applies a full-screen GLSL colour transform to the whole desktop
 * (every application, every monitor) by attaching a Shell.GLSLEffect to
 * Main.layoutManager.uiGroup, which contains global.window_group.
 *
 * Two effect types:
 *   - ColorShiftEffect: a plain 3x3 colour matrix (channel isolation, tints)
 *   - CrtEffect:        the same colour matrix applied first, then a CRT
 *                       layer (scanlines, soft shadow mask, phosphor bloom,
 *                       centre glow, edge vignette, curvature) on top — so
 *                       CRT works over *any* selected colour mode.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';

// Rec.709 luminance weights: turn a colour image into a single-channel image
// (monochrome) so detail is preserved.
const LUMA = [0.2126, 0.7152, 0.0722];
const scale = (v, f) => v.map(x => x * f);

/*
 * Presets — all colour modes. CRT is a separate overlay switch, not a preset.
 */
const PRESETS = [
    {id: 'red',        label: 'Red only',         rows: [[1, 0, 0], [0, 0, 0], [0, 0, 0]]},
    {id: 'green',      label: 'Green only',       rows: [[0, 0, 0], [0, 1, 0], [0, 0, 0]]},
    {id: 'blue',       label: 'Blue only',        rows: [[0, 0, 0], [0, 0, 0], [0, 0, 1]]},
    {id: 'red-mono',   label: 'Red monochrome',   rows: [LUMA, [0, 0, 0], [0, 0, 0]]},
    {id: 'green-mono', label: 'Green monochrome', rows: [[0, 0, 0], LUMA, [0, 0, 0]]},
    {id: 'amber',      label: 'Amber',            rows: [LUMA, scale(LUMA, 0.65), [0, 0, 0]]},
    {id: 'sepia',      label: 'Sepia',            rows: [[0.393, 0.769, 0.189], [0.349, 0.686, 0.168], [0.272, 0.534, 0.131]]},
    {id: 'grayscale',  label: 'Grayscale',        rows: [LUMA, LUMA, LUMA]},
];

function presetById(id) {
    return PRESETS.find(p => p.id === id) ?? PRESETS[0];
}

// Modes shown as radio items in the Quick Settings dropdown. The user manages
// this list from the preferences window; the full set is always available there.
const DEFAULT_FAVORITES = ['red', 'green', 'amber'];

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
 * One fragment pass: apply the selected colour matrix to every sample, then
 * layer the CRT terms on top. Sampling uses the effect's own source texture
 * via a declared sampler (unit 0 at draw time — the FadeEffect pattern).
 *
 * Terms: barrel distortion -> tinted sample + bright-pass phosphor bloom
 *   -> scanlines -> soft shadow mask -> centre glow -> edge vignette
 * ------------------------------------------------------------------ */

const CRT_DEFAULTS = {
    texSize: [1920, 1080],
    scanline: 0.30,
    mask: 0.20,
    bloom: 0.30,
    glow: 0.20,
    vignette: 0.20,
    curvature: 0.05,
    strength: 1.0,
    threshold: 0.30,      // bloom bright-pass
    rows: PRESETS[0].rows,
};

const CrtEffect = GObject.registerClass(
class CrtEffect extends Shell.GLSLEffect {
    _init(params = {}) {
        super._init(params);
        this._u = {
            texSize:   this.get_uniform_location('cs_tex_size'),
            scanline:  this.get_uniform_location('cs_scanline'),
            mask:      this.get_uniform_location('cs_mask'),
            bloom:     this.get_uniform_location('cs_bloom'),
            glow:      this.get_uniform_location('cs_glow'),
            vignette:  this.get_uniform_location('cs_vignette'),
            curvature: this.get_uniform_location('cs_curvature'),
            strength:  this.get_uniform_location('cs_strength'),
            threshold: this.get_uniform_location('cs_threshold'),
            rowR:      this.get_uniform_location('cs_row_r'),
            rowG:      this.get_uniform_location('cs_row_g'),
            rowB:      this.get_uniform_location('cs_row_b'),
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
            uniform float cs_threshold;
            uniform vec3  cs_row_r;
            uniform vec3  cs_row_g;
            uniform vec3  cs_row_b;
            // Declare our own sampler: Cogl binds this effect's offscreen
            // source texture to texture unit 0 when it draws, so a declared
            // sampler defaults to it (same trick the shell's FadeEffect uses).
            uniform sampler2D cs_source;
            vec3 cs_sample_t (vec2 uv) {
                vec3 c = texture2D (cs_source, clamp (uv, 0.0, 1.0)).rgb;
                c = vec3 (dot (cs_row_r, c),
                          dot (cs_row_g, c),
                          dot (cs_row_b, c));
                return c;
            }
        `;
        const src = `
            cogl_color_out = cogl_color_in * texture2D (cs_source, vec2 (cogl_tex_coord_in[0].xy));
            vec2 cs_uv = cogl_tex_coord_in[0].xy;
            vec2 cs_c  = cs_uv - 0.5;
            float cs_r2 = dot (cs_c, cs_c);
            vec2 cs_wuv = cs_uv + cs_c * (cs_r2 * cs_curvature);
            // Fade the tube edge ONLY where the warp actually pushes sampling
            // past [0,1]. With curvature off this is exactly zero, so there is
            // never an always-on dark ring (the "stuck vignette" bug).
            float cs_ox = max (max (-cs_wuv.x, cs_wuv.x - 1.0),
                               max (-cs_wuv.y, cs_wuv.y - 1.0));
            float cs_edge = 1.0 - smoothstep (0.0, 0.015, max (cs_ox, 0.0));
            vec2 cs_suv = clamp (cs_wuv, 0.0, 1.0);
            vec3 cs_col;
            {
                vec2 cs_step = 1.0 / cs_tex_size;
                vec3 cs_base = cs_sample_t (cs_suv);
                vec3 cs_thr = vec3 (cs_threshold);
                vec3 cs_bl = vec3 (0.0);
                cs_bl += max (cs_sample_t (cs_suv + cs_step * vec2 ( 1.0,  0.0)) - cs_thr, vec3 (0.0)) * 0.12;
                cs_bl += max (cs_sample_t (cs_suv + cs_step * vec2 (-1.0,  0.0)) - cs_thr, vec3 (0.0)) * 0.12;
                cs_bl += max (cs_sample_t (cs_suv + cs_step * vec2 ( 0.0,  1.0)) - cs_thr, vec3 (0.0)) * 0.12;
                cs_bl += max (cs_sample_t (cs_suv + cs_step * vec2 ( 0.0, -1.0)) - cs_thr, vec3 (0.0)) * 0.12;
                cs_bl += max (cs_sample_t (cs_suv + cs_step * vec2 ( 2.0,  0.0)) - cs_thr, vec3 (0.0)) * 0.07;
                cs_bl += max (cs_sample_t (cs_suv + cs_step * vec2 (-2.0,  0.0)) - cs_thr, vec3 (0.0)) * 0.07;
                cs_bl += max (cs_sample_t (cs_suv + cs_step * vec2 ( 0.0,  2.0)) - cs_thr, vec3 (0.0)) * 0.07;
                cs_bl += max (cs_sample_t (cs_suv + cs_step * vec2 ( 0.0, -2.0)) - cs_thr, vec3 (0.0)) * 0.07;
                cs_col = cs_base + cs_bl * cs_bloom * 2.0;
                float cs_scan = 0.5 + 0.5 * cos (cs_wuv.y * cs_tex_size.y * 6.2831853);
                cs_col *= mix (1.0, cs_scan, cs_scanline);
                // Soft aperture grille: smooth sine per channel (no hard
                // per-column steps -> no moire on tiny UI elements).
                float cs_px = gl_FragCoord.x;
                vec3 cs_maskv = vec3 (0.55);
                cs_maskv.r = 0.5 + 0.5 * sin (cs_px * 2.094395102);
                cs_maskv.g = 0.5 + 0.5 * sin (cs_px * 2.094395102 + 2.094395102);
                cs_maskv.b = 0.5 + 0.5 * sin (cs_px * 2.094395102 + 4.188790205);
                cs_col *= mix (vec3 (1.0), cs_maskv, cs_mask);
                float cs_rad = length (cs_uv - 0.5) * 1.41421356;
                cs_col += cs_col * cs_glow * (1.0 - smoothstep (0.0, 0.75, cs_rad));
                cs_col *= 1.0 - cs_vignette * smoothstep (0.45, 1.0, cs_rad);
            }
            cs_col *= cs_edge;
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
        this.set_uniform_float(this._u.threshold, 1, [p.threshold]);
        this.set_uniform_float(this._u.rowR, 3, p.rows[0]);
        this.set_uniform_float(this._u.rowG, 3, p.rows[1]);
        this.set_uniform_float(this._u.rowB, 3, p.rows[2]);
        this.queue_repaint();
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
            'Colour Shift', 'Colour + CRT');

        // CRT works on top of any colour.
        this._crtItem = new PopupMenu.PopupSwitchMenuItem('CRT',
            this._settings.get_boolean('crt'));
        this._crtItem.connect('toggled',
            (item, state) => this._settings.set_boolean('crt', state));
        this._toggle.menu.addMenuItem(this._crtItem);

        // Favourite colour modes (radio list).
        this._favoritesSection = new PopupMenu.PopupMenuSection();
        this._toggle.menu.addMenuItem(this._favoritesSection);
        this._items = new Map();
        this._rebuildFavoriteItems();

        this._toggle.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const settingsItem = new PopupMenu.PopupMenuItem('Settings…');
        settingsItem.connect('activate', () => this._extension.openPreferences());
        this._toggle.menu.addMenuItem(settingsItem);

        // Clicking the tile itself toggles on/off.
        this._toggle.connect('clicked', () => {
            this._settings.set_boolean('enabled', this._toggle.checked);
        });

        // Persisted state can come from anywhere (this UI, gsettings CLI, or
        // the preferences window).
        this._settings.connectObject('changed', (settings, key) => {
            if (key === 'favorites')
                this._rebuildFavoriteItems();
            this._sync();
        }, this);

        this.quickSettingsItems.push(this._toggle);
        this._sync();
    }

    _sync() {
        const enabled = this._settings.get_boolean('enabled');
        const crt = this._settings.get_boolean('crt');
        const preset = presetById(this._settings.get_string('preset'));

        this._toggle.checked = enabled;
        this._toggle.subtitle = enabled
            ? (crt ? `${preset.label} · CRT` : preset.label)
            : '';
        this._indicator.visible = enabled;

        this._crtItem.state = crt;

        for (const [id, item] of this._items) {
            item.setOrnament(id === preset.id
                ? PopupMenu.Ornament.DOT
                : PopupMenu.Ornament.NO_DOT);
        }

        this._extension.applyState(enabled ? preset : null, crt);
    }

    _rebuildFavoriteItems() {
        this._favoritesSection.removeAll();
        this._items.clear();

        const favs = this._settings.get_strv('favorites')
            .filter(id => PRESETS.some(p => p.id === id));
        const ids = favs.length > 0 ? favs : DEFAULT_FAVORITES;

        for (const id of ids) {
            const preset = presetById(id);
            const item = new PopupMenu.PopupMenuItem(preset.label);
            item.connect('activate', () => {
                this._settings.set_string('preset', preset.id);
                this._settings.set_boolean('enabled', true);
            });
            this._items.set(preset.id, item);
            this._favoritesSection.addMenuItem(item);
        }
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

        // Effects are created once, but only the active one is attached to
        // uiGroup at any time — never stack two offscreen effects on the
        // whole-stage actor (a documented Mutter failure mode).
        this._matrixEffect = new ColorShiftEffect({name: 'colorshift'});
        this._crtEffect = new CrtEffect({name: 'colorshift-crt'});
        this._activeEffect = null;
        this._unredirectDisabled = false;

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

        if (this._activeEffect)
            Main.layoutManager.uiGroup?.remove_effect(this._activeEffect);
        this._activeEffect = null;
        if (this._unredirectDisabled) {
            global.compositor.enable_unredirect();
            this._unredirectDisabled = false;
        }
        this._matrixEffect = null;
        this._crtEffect = null;
        this._settings = null;
    }

    /** @param {?object} preset  active colour preset, or null for off
     *  @param {boolean} crt     whether the CRT layer is enabled */
    applyState(preset, crt) {
        if (!this._matrixEffect || !this._crtEffect)
            return;

        let effect = null;
        if (preset && crt) {
            this._applyCrtParams(preset);
            effect = this._crtEffect;
        } else if (preset) {
            this._matrixEffect.setRows(preset.rows);
            effect = this._matrixEffect;
        }
        this._setActiveEffect(effect);
    }

    _setActiveEffect(effect) {
        if (this._activeEffect === effect)
            return;
        if (this._activeEffect)
            Main.layoutManager.uiGroup?.remove_effect(this._activeEffect);
        this._activeEffect = effect;
        if (effect) {
            // Fullscreen windows would otherwise be scan-out'd directly to the
            // display (mutter unredirect), bypassing the effect: no tint, no
            // curvature (the straight-edge artifact), and the classic
            // invisible-cursor-in-fullscreen bug. Force compositing instead.
            if (!this._unredirectDisabled) {
                global.compositor.disable_unredirect();
                this._unredirectDisabled = true;
            }
            Main.layoutManager.uiGroup?.add_effect(effect);
        } else if (this._unredirectDisabled) {
            global.compositor.enable_unredirect();
            this._unredirectDisabled = false;
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
            rows: preset.rows,
            strength: 1.0,
        });
    }
}