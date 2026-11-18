import { describe, expect, it } from 'vitest';
import {
  deletePreset,
  describePreset,
  freePresetName,
  hasPreset,
  PresetSettings,
  presetFromText,
  presetToText,
  savePreset,
} from './presets';

const settings: PresetSettings = {
  tank: 'STL',
  ship: '1k/3k',
  days: 16,
  keep: 8,
  balance: false,
  route: ['HRT', 'Curie', 'Avalon'],
};

describe('savePreset', () => {
  it('adds a new preset with an id and a trimmed name', () => {
    const result = savePreset([], '  Tour A ', settings);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ name: 'Tour A', ...settings });
    expect(result[0].id).not.toBe('');
  });

  it('replaces the preset with the same name and keeps its id', () => {
    const first = savePreset([], 'Tour A', settings);
    const other = savePreset(first, 'Tour B', settings);
    const result = savePreset(other, 'tour a', { ...settings, days: 20 });
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(first[0].id);
    expect(result[0].days).toBe(20);
    expect(result[1].name).toBe('Tour B');
  });

  it('copies the route and does not change the old list', () => {
    const route = ['Curie'];
    const first = savePreset([], 'Tour A', { ...settings, route });
    route.push('Avalon');
    expect(first[0].route).toEqual(['Curie']);
    const second = savePreset(first, 'Tour A', { ...settings, days: 1 });
    expect(first[0].days).toBe(16);
    expect(second[0].days).toBe(1);
  });

  it('refuses an empty name', () => {
    expect(() => savePreset([], '   ', settings)).toThrow('needs a name');
  });
});

describe('deletePreset and hasPreset', () => {
  it('removes only the preset with the id', () => {
    const list = savePreset(savePreset([], 'A', settings), 'B', settings);
    const result = deletePreset(list, list[0].id);
    expect(result.map(x => x.name)).toEqual(['B']);
  });

  it('finds a name without looking at case or spaces', () => {
    const list = savePreset([], 'Tour A', settings);
    expect(hasPreset(list, ' TOUR a ')).toBe(true);
    expect(hasPreset(list, 'Tour B')).toBe(false);
  });
});

describe('describePreset', () => {
  it('writes the hub, waypoints, ship and days', () => {
    const [preset] = savePreset([], 'Tour A', settings);
    expect(describePreset(preset)).toBe('HRT, 2 waypoints, 1kt / 3km³, 16 days');
  });

  it('handles a missing hub, a missing ship and balance mode', () => {
    const [preset] = savePreset([], 'Tour A', {
      ...settings,
      route: [' ', 'Curie', 'Avalon'],
      ship: '',
      balance: true,
    });
    expect(describePreset(preset)).toBe('no hub, 2 waypoints, no ship, balance');
  });
});

describe('sharing presets', () => {
  const preset = savePreset([], 'HRT->Adalina', {
    ...settings,
    hubs: [true, false, false],
    transfer: true,
    off: { 'XX-001a': ['ALO'] },
  })[0];

  it('reads back the shared text without the id', () => {
    const text = presetToText(preset);
    expect(text.startsWith('RPRUN-ROUTEBURNS {')).toBe(true);
    expect(text).not.toContain(preset.id);
    const { name, settings: read } = presetFromText(`  ${text}\n`);
    expect(name).toBe('HRT->Adalina');
    expect(read).toEqual({
      ...settings,
      hubs: [true, false, false],
      transfer: true,
      off: { 'XX-001a': ['ALO'] },
    });
  });

  it('refuses other text and bad values', () => {
    expect(() => presetFromText('hello')).toThrow('not a ROUTEBURNS preset');
    expect(() => presetFromText('RPRUN-ROUTEBURNS {bad')).toThrow('damaged');
    const text = presetToText({ ...preset, tank: 'XYZ' as 'STL' });
    expect(() => presetFromText(text)).toThrow('"tank"');
  });

  it('finds a free name', () => {
    const list = savePreset(savePreset([], 'Tour', settings), 'Tour (2)', settings);
    expect(freePresetName(list, 'Tour')).toBe('Tour (3)');
    expect(freePresetName(list, 'Other')).toBe('Other');
  });
});
