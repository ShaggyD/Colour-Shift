/* Colour Shift — a GNOME Shell extension.
 *
 * Applies a full-screen GLSL colour transform to the whole desktop
 * (every application, every monitor) by attaching a Shell.GLSLEffect to
 * Main.layoutManager.uiGroup, which contains global.window_group.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';

// Rec.709 luminance weights: used to turn a colour image into a
// single-channel (monochrome) image so detail is preserved.
const LUMA = [0.2126, 0.7152, 0.0722];
const scale = (v, f) => v.map(x => x * f);

/*
 * Each preset is a 3x3 colour matrix stored row-major as three vec3s.
 * The shader computes:  out.rgb = [ dot(rowR,in), dot(rowG,in), dot(rowB,in) ]
 *
 *   channel isolation  -> "only this colour of light leaves the panel"
 *   monochrome tints    -> luminance reproduced in one colour (more detail)
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

/* The GLSL effect. It sits on the compositor's uiGroup, so it tints the
 * shell UI *and* every application window, on every monitor. */
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

/* Quick Settings toggle + dropdown, plus a panel indicator that appears
 * only while the filter is on. */
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
            'Colour Shift', 'Choose a colour');

        // One radio item per preset in the dropdown.
        this._items = new Map();
        for (const preset of PRESETS) {
            const item = new PopupMenu.PopupMenuItem(preset.label);
            item.connect('activate', () => {
                this._settings.set_string('preset', preset.id);
                // Selecting a colour turns the filter on.
                this._settings.set_boolean('enabled', true);
            });
            this._items.set(preset.id, item);
            this._toggle.menu.addMenuItem(item);
        }

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

        this._extension.applyPreset(enabled ? preset : null);
    }

    destroy() {
        this._settings?.disconnectObject(this);
        this.quickSettingsItems?.forEach(item => item.destroy());
        this.quickSettingsItems = [];
        super.destroy();
    }
});

export default class ColorShiftExtension extends Extension {
    enable() {
        this._settings = this.getSettings();

        // The effect is created once and left attached; we flip its
        // `enabled` flag (the same pattern the shell uses for its own
        // desaturate / brightness effects on uiGroup).
        this._effect = new ColorShiftEffect({name: 'colorshift'});
        this._effect.enabled = false;
        Main.layoutManager.uiGroup.add_effect(this._effect);

        this._indicator = new ColorShiftIndicator(this);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;

        if (this._effect) {
            Main.layoutManager.uiGroup?.remove_effect(this._effect);
            this._effect = null;
        }

        this._settings = null;
    }

    /** @param {?object} preset a preset from PRESETS, or null to switch off */
    applyPreset(preset) {
        if (!this._effect)
            return;

        if (!preset) {
            this._effect.enabled = false;
            return;
        }

        this._effect.setRows(preset.rows);
        this._effect.enabled = true;
    }
}
