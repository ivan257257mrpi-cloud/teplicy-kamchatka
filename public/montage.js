const stageStarts = [0, 0.16, 0.37, 0.68, 0.9];

export function scrollProgress(top, travel) {
  return travel > 0 ? Math.max(0, Math.min(1, -top / travel)) : 0;
}

export function stageAt(progress) {
  return stageStarts.findLastIndex(start => progress >= start);
}

export function stagePosition(index) {
  return (stageStarts[index] + (stageStarts[index + 1] ?? 1)) / 2;
}
