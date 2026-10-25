// Pure timing foundation. Rates interpolate linearly in playback time;
// integrating them gives a continuous source position, not stepped speeds.
export function validateSpeedCurve(points) {
  if (!Array.isArray(points) || points.length < 2 || points.length > 128)
    throw Error('A speed curve needs 2–128 points.');
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!p || typeof p!=='object' || Array.isArray(p) || Object.keys(p).some(k=>!['time','speed'].includes(k)) || !Number.isFinite(p.time) || p.time < 0 || p.time > 7200 ||
        !Number.isFinite(p.speed) || p.speed < .25 || p.speed > 4 ||
        (i === 0 ? p.time !== 0 : p.time <= points[i - 1].time))
      throw Error('Speed points must start at zero, increase in time, and use speeds 0.25–4.');
  }
  return points;
}

function sample(points, time) {
  if (!Number.isFinite(time) || time < 0 || time > points.at(-1).time)
    throw Error('Playback time is outside the speed curve.');
  let source = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const width = b.time - a.time, dt = Math.min(time, b.time) - a.time;
    const slope = (b.speed - a.speed) / width;
    if (time <= b.time) return {source: source + a.speed * dt + slope * dt * dt / 2, speed: a.speed + slope * dt};
    source += width * (a.speed + b.speed) / 2;
  }
}

export function sourceAtPlayback(points, time) {
  validateSpeedCurve(points);
  return sample(points, time).source;
}

export function playbackAtSource(points, source) {
  validateSpeedCurve(points);
  const total = sample(points, points.at(-1).time).source;
  if (!Number.isFinite(source) || source < 0 || source > total)
    throw Error('Source offset is outside the speed curve.');
  // Monotonic positive rates guarantee a unique inverse; bisection avoids
  // cancellation in the quadratic formula for almost-constant rates.
  let lo = 0, hi = points.at(-1).time;
  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2;
    if (sample(points, mid).source < source) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

export function sliceSpeedCurve(points, start, end) {
  validateSpeedCurve(points);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 ||
      end > points.at(-1).time || end <= start) throw Error('Invalid speed curve slice.');
  return [
    {time: 0, speed: sample(points, start).speed},
    ...points.filter(p => p.time > start && p.time < end).map(p => ({time: p.time - start, speed: p.speed})),
    {time: end - start, speed: sample(points, end).speed},
  ];
}

export function validateItemRemap(item) {
  if (item.speedCurve === undefined) return;
  validateSpeedCurve(item.speedCurve);
  if (item.speedCurve.length > 32 || item.speedCurve.at(-1).time > 120 || item.sourceOut - item.sourceIn > 60)
    throw Error('Time remapping supports 32 points, 60 source seconds and 120 playback seconds per item.');
  if (item.reverse || item.frameHold || item.speed !== 1)
    throw Error('Clear reverse/freeze and use constant speed 1 before adding a speed curve.');
  if (Math.abs(sourceAtPlayback(item.speedCurve,item.speedCurve.at(-1).time) - (item.sourceOut-item.sourceIn)) > 1e-8)
    throw Error('The integrated speed curve must consume the retained source range exactly.');
}

// FFmpeg receives source timestamps; invert each integrated linear-rate segment.
export function remapTimestampExpression(points, variable='(PTS-STARTPTS)*TB') {
  validateSpeedCurve(points);
  let source=0;
  const segments=[];
  for(let i=1;i<points.length;i++) {
    const a=points[i-1],b=points[i],width=b.time-a.time,k=(b.speed-a.speed)/width;
    const x=`max(0,(${variable})-${source})`;
    // Rationalized quadratic root is stable for small slopes, including k=0.
    const expression=`${a.time}+2*(${x})/(${a.speed}+sqrt(max(0,${a.speed*a.speed}+${2*k}*(${x}))))`;
    source+=width*(a.speed+b.speed)/2;
    segments.push({end:source,expression});
  }
  let result=segments.at(-1).expression;
  for(let i=segments.length-2;i>=0;i--)result=`if(lt(${variable},${segments[i].end}),${segments[i].expression},${result})`;
  return `(${result})/TB`;
}
