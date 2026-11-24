const stageStarts = [0, 0.16, 0.37, 0.68, 0.9];
export const montageSheetSide = 4;
export const montageSheetCount = 6;
const framesPerSheet = montageSheetSide ** 2;

export function scrollProgress(top, travel) {
  return travel > 0 ? Math.max(0, Math.min(1, -top / travel)) : 0;
}

export function stageAt(progress) {
  return stageStarts.findLastIndex(start => progress >= start);
}

export function stagePosition(index) {
  return (stageStarts[index] + (stageStarts[index + 1] ?? 1)) / 2;
}

export function montageFrame(progress) {
  const frame = Math.round(progress * (framesPerSheet * montageSheetCount - 1));
  const tile = frame % framesPerSheet;
  return {
    sheet: Math.floor(frame / framesPerSheet),
    column: tile % montageSheetSide,
    row: Math.floor(tile / montageSheetSide)
  };
}
