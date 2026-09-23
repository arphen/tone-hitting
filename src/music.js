export const SOLFEGE = ['DO', 'RE', 'MI', 'FA', 'SO', 'LA', 'TI', 'DO'];
export const SCALE_OFFSETS = [0, 2, 4, 5, 7, 9, 11, 12];

export const RANGE_PRESETS = {
  lower: { id: 'lower', label: 'LOWER', minMidi: 48, maxMidi: 60, rootMidi: 48 },
  higher: { id: 'higher', label: 'HIGHER', minMidi: 60, maxMidi: 72, rootMidi: 60 },
};

export function getRange(id = 'lower') {
  return RANGE_PRESETS[id] || RANGE_PRESETS.lower;
}

export function frequencyFromMidi(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function midiFromFrequency(frequency) {
  return 69 + 12 * Math.log2(frequency / 440);
}

export function centsBetween(frequency, targetFrequency) {
  if (!Number.isFinite(frequency) || !Number.isFinite(targetFrequency) || frequency <= 0 || targetFrequency <= 0) return null;
  return Math.round(1200 * Math.log2(frequency / targetFrequency));
}

export function targetMidiForIndex(index, range = RANGE_PRESETS.lower) {
  const safeIndex = Math.max(0, Math.min(index, SCALE_OFFSETS.length - 1));
  return range.rootMidi + SCALE_OFFSETS[safeIndex];
}

export function targetForIndex(index, range = RANGE_PRESETS.lower) {
  const midi = targetMidiForIndex(index, range);
  return { index, solfege: SOLFEGE[index], midi, note: noteNameFromMidi(midi), hz: frequencyFromMidi(midi) };
}

export function noteNameFromMidi(midi) {
  const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const rounded = Math.round(midi);
  return `${names[(rounded % 12 + 12) % 12]}${Math.floor(rounded / 12) - 1}`;
}

export function midiToRatio(midi, range = RANGE_PRESETS.lower) {
  return (midi - range.minMidi) / (range.maxMidi - range.minMidi);
}

export function midiToY(midi, height, range = RANGE_PRESETS.lower, top = 0.12, bottom = 0.88) {
  const ratio = Math.max(0, Math.min(1, midiToRatio(midi, range)));
  return height * (bottom - ratio * (bottom - top));
}

export function frequencyForRangeStep(index, rangeId = 'lower') {
  return frequencyFromMidi(targetMidiForIndex(index, getRange(rangeId)));
}
