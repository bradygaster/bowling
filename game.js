(function () {
  "use strict";
  const { BowlingGame, PIN_LAYOUT, simulateRoll, ballPosition, rollMarks } = window.Bowling;
  const $ = id => document.getElementById(id);
  const canvas = $("lane");
  const ctx = canvas.getContext("2d");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let game = new BowlingGame();
  let standing = PIN_LAYOUT.map(pin => pin.id);
  let fallen = [];
  let state = "ready";
  let power = 0.8;
  let animation = 0;
  let generation = 0;
  let ballProgress = null;
  let activeShot = null;
  let width = 1;
  let height = 1;
  let best = null;
  let visualKnockdowns = [];

  function storageWarning() {
    $("storage-warning").hidden = false;
    $("storage-warning").textContent = "Browser storage is unavailable. Your game still works, but your personal best cannot be saved.";
  }
  try {
    const value = localStorage.getItem("spare-time-best");
    if (value !== null && /^\d+$/.test(value) && Number(value) <= 300) best = Number(value);
  } catch (_) { storageWarning(); }

  function shotSettings() {
    return { aim: Number($("aim").value) / 100, hook: Number($("hook").value) / 100, power };
  }
  function updatePower() {
    const percent = Math.round(power * 100);
    $("power-value").textContent = `${percent}%`;
    $("power-fill").style.width = `${percent}%`;
    $("power-marker").style.left = `calc(${percent}% - 2px)`;
    document.querySelector(".power-meter").setAttribute("aria-valuenow", percent);
  }
  function direction(value) {
    return value === 0 ? "STRAIGHT" : `${value < 0 ? "LEFT" : "RIGHT"} ${Math.abs(value)}`;
  }
  function updateSettings() {
    $("aim-value").textContent = direction(Number($("aim").value));
    $("hook-value").textContent = direction(Number($("hook").value));
    draw();
  }

  function updateHUD() {
    const index = game.frameIndex;
    $("frame-number").innerHTML = `${String(index + 1).padStart(2, "0")} <small>/ 10</small>`;
    $("ball-number").textContent = game.complete ? "—" : String(game.frames[index].length + 1).padStart(2, "0");
    $("total-score").textContent = String(game.total).padStart(3, "0");
    $("best-score").textContent = best === null ? "—" : String(best).padStart(3, "0");
    $("pins-left").textContent = `${standing.length} PIN${standing.length === 1 ? "" : "S"} STANDING`;
    canvas.setAttribute("aria-label", `Bowling lane: ${standing.length} pins standing. Frame ${index + 1}. ${game.complete ? "Game complete." : "Press Enter or Space to set power and release."}`);
    const scores = game.scores();
    $("frame-headings").replaceChildren();
    $("frame-rolls").replaceChildren();
    $("frame-scores").replaceChildren();
    game.frames.forEach((frame, i) => {
      const active = i === index && !game.complete;
      const heading = document.createElement("th");
      heading.scope = "col";
      heading.textContent = String(i + 1).padStart(2, "0");
      heading.className = active ? "current" : "";
      $("frame-headings").append(heading);
      const rolls = document.createElement("td");
      rolls.className = active ? "current" : "";
      const marks = rollMarks(frame, i);
      const slots = document.createElement("div");
      slots.className = "rolls";
      for (let j = 0; j < (i === 9 ? 3 : 2); j++) {
        const mark = document.createElement("span");
        mark.textContent = marks[j] || "\u00a0";
        slots.append(mark);
      }
      rolls.append(slots);
      rolls.setAttribute("aria-label", `Frame ${i + 1} rolls: ${frame.length ? frame.join(", ") : "not played"}`);
      $("frame-rolls").append(rolls);
      const score = document.createElement("td");
      score.className = active ? "current" : "";
      score.textContent = scores[i] === null ? "·" : scores[i];
      score.setAttribute("aria-label", scores[i] === null ? "Score pending" : `Cumulative score ${scores[i]}`);
      $("frame-scores").append(score);
    });
    $("aim").disabled = state === "rolling" || game.complete;
    $("hook").disabled = state === "rolling" || game.complete;
    $("roll").disabled = state === "rolling";
    $("roll").classList.toggle("charging", state === "charging");
    const label = game.complete ? "PLAY AGAIN" : state === "rolling" ? "BALL IN MOTION" : state === "charging" ? "RELEASE BALL" : "SET POWER";
    $("roll").innerHTML = `${label} <span aria-hidden="true">↗</span>`;
    $("button-help").textContent = game.complete ? "Another round? Your next great game is waiting." : state === "charging" ? "Stop in the yellow zone. Tap now to release!" : state === "rolling" ? "Watch your line. The pins are listening." : "Tap once to charge. Tap again to bowl.";
    $("score-status").textContent = game.complete ? "THAT’S A WRAP. SAME TIME NEXT GAME?" : "BONUSES FILL IN AFTER YOUR NEXT ROLLS.";
  }
  function message(title, detail, celebrate = false) {
    $("result-title").textContent = title;
    $("result-detail").textContent = detail;
    $("result-strip").classList.toggle("celebrate", celebrate);
    $("announcement").textContent = `${title} ${detail}`;
  }

  // Perspective projection: the same normalized geometry drives the preview,
  // animated ball and physics model.
  function project(x, y) {
    const depth = Math.max(0, Math.min(1.05, y));
    const half = width * (0.34 - depth * 0.19);
    return { x: width / 2 + x * half, y: height * (0.91 - depth * 0.69), scale: 1 - depth * 0.50 };
  }
  function line(points, fill, stroke = "#20201e", lineWidth = 2) {
    ctx.beginPath();
    points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.stroke(); }
  }
  function drawPin(pin, down, fallProgress = 1) {
    const p = project(pin.x, pin.y);
    const size = Math.min(21, width * 0.038) * p.scale;
    ctx.save();
    ctx.translate(p.x, p.y);
    if (down) {
      ctx.rotate((pin.x < 0 ? -1.15 : 1.15) * fallProgress);
      ctx.globalAlpha = 1 - 0.55 * fallProgress;
    }
    ctx.fillStyle = "#20201e25";
    ctx.beginPath(); ctx.ellipse(2, 3, size * 0.62, size * 0.21, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-size * 0.43, 0);
    ctx.bezierCurveTo(-size * 0.8, -size * 0.7, -size * 0.1, -size, -size * 0.24, -size * 1.5);
    ctx.bezierCurveTo(-size * 0.65, -size * 2.3, size * 0.65, -size * 2.3, size * 0.24, -size * 1.5);
    ctx.bezierCurveTo(size * 0.1, -size, size * 0.8, -size * 0.7, size * 0.43, 0);
    ctx.closePath(); ctx.fillStyle = "#fffaf0"; ctx.fill(); ctx.strokeStyle = "#20201e"; ctx.lineWidth = 1.8; ctx.stroke();
    ctx.fillStyle = "#ff6d7f";
    ctx.fillRect(-size * 0.24, -size * 1.4, size * 0.48, size * 0.13);
    ctx.fillRect(-size * 0.23, -size * 1.15, size * 0.46, size * 0.13);
    ctx.restore();
  }
  function drawBall(t, shot) {
    const location = ballPosition(t, shot.aim, shot.hook);
    if (Math.abs(location.x) > 0.98) location.x = Math.sign(location.x) * 1.1;
    const p = project(location.x, location.y);
    const radius = Math.min(29, width * 0.055) * p.scale;
    ctx.save();
    ctx.translate(p.x, p.y - radius * 0.65);
    ctx.fillStyle = "#20201e30"; ctx.beginPath(); ctx.ellipse(3, radius * 0.8, radius * 1.1, radius * 0.4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.rotate(-t * 12);
    ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.fillStyle = "#244ed6"; ctx.fill(); ctx.strokeStyle = "#20201e"; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.beginPath(); ctx.arc(-radius * 0.2, -radius * 0.2, radius * 0.65, Math.PI, Math.PI * 1.55); ctx.strokeStyle = "#ffffff60"; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = "#111e56";
    [[0.05, -0.4], [0.39, -0.14], [-0.12, -0.03]].forEach(([x,y]) => { ctx.beginPath(); ctx.arc(x * radius, y * radius, radius * 0.13, 0, Math.PI * 2); ctx.fill(); });
    ctx.restore();
  }
  function draw() {
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    const near = project(-1.25, 0), far = project(-1.25, 1.08);
    line([near, far, project(1.25, 1.08), project(1.25, 0)], "#747f76");
    for (const sign of [-1, 1]) {
      line([project(sign * 1.02, 0), project(sign * 1.02, 1.08), project(sign * 1.18, 1.08), project(sign * 1.18, 0)], "#343b37");
      for (let y = 0; y < 1; y += 0.05) {
        const a = project(sign * 1.05, y), b = project(sign * 1.16, y + 0.03);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.strokeStyle = "#727e70"; ctx.lineWidth = 1; ctx.stroke();
      }
    }
    line([project(-1, 0), project(-1, 1.08), project(1, 1.08), project(1, 0)], "#deb67b");
    for (let board = 0; board < 20; board++) {
      const x = -1 + board / 10;
      line([project(x, 0), project(x, 1.08), project(x + 0.1, 1.08), project(x + 0.1, 0)], board % 3 === 0 ? "#eccb93" : board % 3 === 1 ? "#e4bd83" : "#dcb077", "#20201e18", 0.8);
      for (let j = 0; j < 5; j++) {
        const y = ((board * 13 + j * 23) % 100) / 100;
        const a = project(x + 0.025, y), b = project(x + 0.035, Math.min(1.06, y + 0.09));
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.strokeStyle = "#895e3825"; ctx.stroke();
        const c = project(x, y), d = project(x + 0.1, y);
        ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.strokeStyle = "#895e3830"; ctx.stroke();
      }
    }
    line([project(-1, 0.1), project(-1, 0.115), project(1, 0.115), project(1, 0.1)], "#20201e", null);
    for (let i = -3; i <= 3; i++) {
      const x = i * 0.21, y = 0.37 + Math.abs(i) * 0.025;
      line([project(x, y + 0.022), project(x - 0.025, y), project(x + 0.025, y)], "#20201e", null);
    }
    ctx.save();
    ctx.fillStyle = "#20201e";
    ctx.font = `900 ${Math.max(10, width * 0.018)}px "Courier New", monospace`;
    ctx.textAlign = "center";
    if (height >= 220) ctx.fillText("SPARE TIME / 01", width / 2, height * 0.14);
    ctx.restore();
    if (state !== "rolling" && !game.complete) {
      const shot = shotSettings();
      ctx.beginPath();
      for (let t = 0.12; t <= 1; t += 0.02) {
        const ball = ballPosition(t, shot.aim, shot.hook);
        const p = project(ball.x, t);
        if (t === 0.12) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = "#244ed68a"; ctx.lineWidth = 2; ctx.setLineDash([4, 7]); ctx.stroke(); ctx.setLineDash([]);
      const end = ballPosition(0.76, shot.aim, shot.hook), p = project(end.x, end.y);
      ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, Math.PI * 2); ctx.strokeStyle = "#244ed6"; ctx.lineWidth = 1.5; ctx.stroke();
    }
    PIN_LAYOUT.slice().reverse().forEach(pin => {
      if (standing.includes(pin.id)) {
        const falling = visualKnockdowns.includes(pin.id);
        drawPin(pin, falling, falling ? Math.min(1, Math.max(0, (ballProgress - 0.76) / 0.19)) : 1);
      }
      else if (fallen.includes(pin.id)) drawPin(pin, true);
    });
    if (!game.complete && ballProgress !== null) drawBall(ballProgress, activeShot);
    else if (!game.complete) drawBall(0.025, shotSettings());
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = rect.width; height = rect.height;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    if (ctx) ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    draw();
  }
  function finishRoll(result, oldFrame, shotNumber) {
    const count = result.knocked.length;
    const outcome = game.roll(count);
    fallen = [...fallen, ...result.knocked];
    standing = result.standing;
    state = "ready";
    ballProgress = null;
    visualKnockdowns = [];
    const mark = rollMarks(game.frames[oldFrame], oldFrame)[shotNumber - 1];
    const strike = mark === "X";
    const spare = mark === "/";
    let title = strike ? "STRIKE! THAT’S THE STUFF." : spare ? "SPARE! CLEANED HOUSE." : count === 0 ? (result.gutter ? "GUTTER. IT HAPPENS." : "A SWING & A MISS.") : `${count} DOWN. NICE WORK.`;
    let detail = game.complete ? `Final score: ${game.total}. Ten frames, well spent. Play again?` : outcome.newRack ? `Fresh rack. Frame ${game.frameIndex + 1}, ball ${game.frames[game.frameIndex].length + 1}. Keep the good times rolling.` : `${standing.length} left standing. Adjust your line and finish the job.`;
    if (game.complete) {
      title = game.total === 300 ? "PERFECT 300. YOU LEGEND." : "THAT’S A WRAP!";
      if (best === null || game.total > best) {
        best = game.total;
        detail = `New personal best: ${best}! Ten frames, well spent.`;
        try { localStorage.setItem("spare-time-best", String(best)); } catch (_) { storageWarning(); }
      }
    }
    if (outcome.newRack && !game.complete) {
      standing = PIN_LAYOUT.map(pin => pin.id);
      fallen = [];
    }
    message(title, detail, strike || spare || game.complete);
    updateHUD();
    draw();
  }

  function release() {
    cancelAnimationFrame(animation);
    state = "rolling";
    activeShot = shotSettings();
    const shot = activeShot;
    const token = generation;
    const result = simulateRoll({ ...shot, standing });
    visualKnockdowns = result.knocked;
    const oldFrame = game.frameIndex;
    const frame = game.frames[oldFrame];
    const shotNumber = frame.length + 1;
    const start = performance.now();
    const duration = reducedMotion.matches ? 180 : 1350;
    updateHUD();
    message("HERE COMES THE GOOD STUFF.", `Ball ${shotNumber} rolling at ${Math.round(power * 100)}% power.`);
    function tick(now) {
      if (token !== generation) return;
      ballProgress = Math.min(1.07, ((now - start) / duration) * 1.07);
      draw();
      if (now - start < duration) animation = requestAnimationFrame(tick);
      else finishRoll(result, oldFrame, shotNumber);
    }
    animation = requestAnimationFrame(tick);
  }
  function play() {
    if (game.complete) { restart(); return; }
    if (state === "rolling") return;
    if (state === "charging") { release(); return; }
    state = "charging";
    updateHUD();
    const start = performance.now();
    message("FEEL THE POWER.", "Tap Release Ball when the meter reaches the yellow zone.");
    if (reducedMotion.matches) {
      power = 0.85;
      updatePower();
      $("button-help").textContent = "Reduced motion: steady 85% power. Tap to release.";
      draw();
      return;
    }
    function charge(now) {
      const phase = ((now - start) / 1050) % 2;
      power = 0.12 + (phase <= 1 ? phase : 2 - phase) * 0.88;
      updatePower();
      animation = requestAnimationFrame(charge);
    }
    animation = requestAnimationFrame(charge);
    draw();
  }
  function restart() {
    generation++;
    cancelAnimationFrame(animation);
    game = new BowlingGame();
    standing = PIN_LAYOUT.map(pin => pin.id);
    fallen = []; visualKnockdowns = [];
    ballProgress = null; activeShot = null;
    state = "ready"; power = 0.8;
    $("aim").value = 10; $("hook").value = 15;
    updatePower(); updateSettings(); updateHUD();
    message("THE LANE IS YOURS.", "Find your line. Set your power. Make some noise.");
    draw();
  }
  $("roll").addEventListener("click", play);
  $("restart").addEventListener("click", restart);
  $("aim").addEventListener("input", updateSettings);
  $("hook").addEventListener("input", updateSettings);
  canvas.addEventListener("keydown", event => {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      if (!event.repeat) play();
    }
  });
  reducedMotion.addEventListener("change", () => {
    if (state === "charging" && reducedMotion.matches) {
      cancelAnimationFrame(animation); power = 0.85; updatePower();
      $("button-help").textContent = "Reduced motion: steady 85% power. Tap to release.";
    }
  });
  window.addEventListener("resize", resize);
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(resize).observe(canvas);
  updatePower(); updateSettings(); updateHUD(); resize();
})();
