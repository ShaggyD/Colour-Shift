/* Colour Shift — preferences window (opened from the Extensions app or via
 * `gnome-extensions prefs colorshift@dchadwick.local`).
 *
 * Everything is configured here: the full mode list, which modes appear as
 * favourites in Quick Settings, and all CRT parameters. Changes apply live.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const PRESETS = [
    {id: 'red',        label: 'Red only'},
    {id: 'green',      label: 'Green only'},
    {id: 'blue',       label: 'Blue only'},
    {id: 'red-mono',   label: 'Red monochrome'},
    {id: 'green-mono', label: 'Green monochrome'},
    {id: 'amber',      label: 'Amber'},
    {id: 'sepia',      label: 'Sepia'},
    {id: 'grayscale',  label: 'Grayscale'},
];

function percentSliderRow(title, subtitle, key, settings) {
    const row = new Adw.ActionRow({title, subtitle});
    const scale = Gtk.Scale.new_with_range(
        Gtk.Orientation.HORIZONTAL, 0, 1, 0.01);
    scale.hexpand = true;
    scale.set_size_request(220, -1);

    scale.set_value(settings.get_double(key));
    scale.connect('value-changed',
        () => settings.set_double(key, scale.get_value()));
    settings.connect('changed::' + key,
        () => scale.set_value(settings.get_double(key)));

    row.add_suffix(scale);
    return row;
}

function switchRow(title, subtitle, key, settings) {
    const row = new Adw.SwitchRow({title, subtitle});
    row.active = settings.get_boolean(key);
    row.connect('notify::active',
        () => settings.set_boolean(key, row.active));
    settings.connect('changed::' + key, () => {
        row.active = settings.get_boolean(key);
    });
    return row;
}

export default class ColorShiftPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings; // keep the object alive for the window

        // ------------------------- Modes page -------------------------
        const modesPage = new Adw.PreferencesPage({title: 'Modes'});

        const modeGroup = new Adw.PreferencesGroup({
            title: 'Mode',
            description: 'The colour shift applied, plus an optional CRT overlay that works on top of any colour.',
        });

        const combo = new Adw.ComboRow({title: 'Current mode'});
        combo.model = new Gtk.StringList({strings: PRESETS.map(p => p.label)});
        const ids = PRESETS.map(p => p.id);
        const syncCombo = () => {
            const idx = ids.indexOf(settings.get_string('preset'));
            if (idx >= 0 && idx !== combo.selected)
                combo.selected = idx;
        };
        combo.selected = Math.max(0, ids.indexOf(settings.get_string('preset')));
        combo.connect('notify::selected', () => {
            settings.set_string('preset', ids[combo.selected]);
            settings.set_boolean('enabled', true);
        });
        settings.connect('changed::preset', () => syncCombo());
        modeGroup.add(combo);
        modeGroup.add(switchRow('Enabled', 'Turn the filter on', 'enabled', settings));
        modeGroup.add(switchRow('CRT overlay',
            'CRT emulation on top of the selected colour', 'crt', settings));
        modesPage.add(modeGroup);

        const favGroup = new Adw.PreferencesGroup({
            title: 'Quick Settings favourites',
            description: 'Only the modes switched on here appear in the Quick Settings dropdown.',
        });
        for (const preset of PRESETS) {
            const row = new Adw.SwitchRow({
                title: preset.label,
                subtitle: preset.id,
            });
            const sync = () => {
                const favs = settings.get_strv('favorites');
                row.active = favs.includes(preset.id);
            };
            row.connect('notify::active', () => {
                const favs = settings.get_strv('favorites');
                if (row.active && !favs.includes(preset.id))
                    favs.push(preset.id);
                else if (!row.active)
                    settings.set_strv('favorites',
                        favs.filter(id => id !== preset.id));
                else
                    settings.set_strv('favorites', favs);
            });
            settings.connect('changed::favorites', () => sync());
            sync();
            favGroup.add(row);
        }
        modesPage.add(favGroup);
        window.add(modesPage);

        // -------------------------- CRT page --------------------------
        const crtPage = new Adw.PreferencesPage({title: 'CRT'});
        const crtGroup = new Adw.PreferencesGroup({
            title: 'CRT display',
            description: 'Tune the CRT overlay. Enable CRT in Modes → CRT overlay; changes apply live.',
        });

        crtGroup.add(percentSliderRow('Scanlines',
            'Darkens alternating pixel rows', 'crt-scanline', settings));
        crtGroup.add(percentSliderRow('Shadow mask',
            'RGB aperture-grille ("window screen") strength', 'crt-mask', settings));
        crtGroup.add(percentSliderRow('Phosphor glow',
            'Multi-tap bloom around bright areas', 'crt-bloom', settings));
        crtGroup.add(percentSliderRow('Glass glow',
            'Radial glow in the centre of the tube', 'crt-glow', settings));
        crtGroup.add(percentSliderRow('Edge vignette',
            'Darkening toward the outer edges', 'crt-vignette', settings));
        crtGroup.add(switchRow('Curvature',
            'Barrel distortion (glass bulge)', 'crt-curvature', settings));
        crtGroup.add(percentSliderRow('Curvature amount',
            'Distortion strength', 'crt-curvature-amount', settings));

        crtPage.add(crtGroup);
        window.add(crtPage);
    }
}