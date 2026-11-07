(function (root) {
  "use strict";

  const PIN_LAYOUT = Object.freeze([
    { id: 1, x: 0, y: 0.76 },
    { id: 2, x: -0.21, y: 0.83 }, { id: 3, x: 0.21, y: 0.83 },
    { id: 4, x: -0.42, y: 0.90 }, { id: 5, x: 0, y: 0.90 }, { id: 6, x: 0.42, y: 0.90 },
    { id: 7, x: -0.63, y: 0.97 }, { id: 8, x: -0.21, y: 0.97 },
    { id: 9, x: 0.21, y: 0.97 }, { id: 10, x: 0.63, y: 0.97 }
  ].map(Object.freeze));

  class BowlingGame {
    constructor() {
      this.frames = Array.from({ length: 10 }, () => []);
      this.frameIndex = 0;
      this.remaining = 10;
      this.complete = false;
    }

    roll(pins) {
      if (this.complete) throw new RangeError("The game is already complete.");
      if (!Number.isInteger(pins) || pins < 0 || pins > this.remaining) {
        throw new RangeError(`Roll must be an integer from 0 to ${this.remaining}.`);
      }
      const frame = this.frames[this.frameIndex];
      frame.push(pins);
      this.remaining -= pins;
      let newRack = false;
      if (this.frameIndex < 9) {
        if (pins === 10 || frame.length === 2) {
          this.frameIndex++;
          this.remaining = 10;
          newRack = true;
        }
      } else if (frame.length === 1 && pins === 10) {
        this.remaining = 10;
        newRack = true;
      } else if (frame.length === 2) {
        if (frame[0] + frame[1] < 10) this.complete = true;
        else if (this.remaining === 0) {
          this.remaining = 10;
          newRack = true;
        }
      } else if (frame.length === 3) {
        this.complete = true;
      }
      return { newRack, complete: this.complete };
    }

    scores() {
      let total = 0;
      let unresolved = false;
      return this.frames.map((frame, i) => {
        if (!frame.length || unresolved) {
          unresolved = true;
          return null;
        }
        let value;
        if (i === 9) {
          if (!this.complete) {
            unresolved = true;
            return null;
          }
          value = frame.reduce((a, b) => a + b, 0);
        } else {
          const next = this.frames.slice(i + 1).flat();
          if (frame[0] === 10) {
            if (next.length < 2) { unresolved = true; return null; }
            value = 10 + next[0] + next[1];
          } else if (frame.length === 2 && frame[0] + frame[1] === 10) {
            if (!next.length) { unresolved = true; return null; }
            value = 10 + next[0];
          } else if (frame.length === 2) value = frame[0] + frame[1];
          else { unresolved = true; return null; }
        }
        total += value;
        return total;
      });
    }

    get total() {
      return this.scores().filter(value => value !== null).at(-1) || 0;
    }
  }

  function scoreGame(rolls) {
    if (!Array.isArray(rolls)) throw new TypeError("Expected an array of rolls.");
    const game = new BowlingGame();
    for (const pins of rolls) game.roll(pins);
    return { total: game.total, scores: game.scores(), complete: game.complete };
  }

  function rollMarks(frame, index) {
    return frame.map((pins, i) => {
      const freshRack = i === 0 || (index === 9 && (i === 1
        ? frame[0] === 10
        : frame[1] === 10 || (frame[0] !== 10 && frame[0] + frame[1] === 10)));
      if (freshRack && pins === 10) return "X";
      if (i > 0 && !freshRack && frame[i - 1] + pins === 10) return "/";
      return pins === 0 ? "–" : String(pins);
    });
  }

  function ballPosition(t, aim, hook) {
    return { x: aim * t + hook * 0.45 * t * t * t, y: t };
  }

  function simulateRoll({ aim, hook, power, standing = PIN_LAYOUT.map(pin => pin.id) }) {
    if (![aim, hook, power].every(Number.isFinite) ||
        Math.abs(aim) > 1 || Math.abs(hook) > 1 || power < 0 || power > 1) {
      throw new RangeError("Aim and hook must be within -1…1; power within 0…1.");
    }
    if (!Array.isArray(standing) || new Set(standing).size !== standing.length ||
        standing.some(id => !PIN_LAYOUT.some(pin => pin.id === id))) {
      throw new RangeError("Standing pins must be unique pin IDs from 1 to 10.");
    }
    const pins = PIN_LAYOUT.filter(pin => standing.includes(pin.id));
    const energy = new Map();
    const queue = [];
    let gutter = false;
    // A moving ball transfers energy to nearby pins; displaced pins transfer
    // less energy sideways than forward through the triangular rack.
    for (let step = 0; step <= 240; step++) {
      const t = step / 240;
      const ball = ballPosition(t, aim, hook);
      if (Math.abs(ball.x) > 0.98) { gutter = true; break; }
      if (power < 0.08) continue;
      for (const pin of pins) {
        const distance = Math.hypot(ball.x - pin.x, (ball.y - pin.y) * 3);
        if (distance < 0.17) {
          const impact = power * (1 - distance / 0.26);
          if (impact > (energy.get(pin.id) || 0)) {
            energy.set(pin.id, impact);
            queue.push(pin);
          }
        }
      }
    }
    while (queue.length) {
      const source = queue.shift();
      const sourceEnergy = energy.get(source.id);
      for (const target of pins) {
        if (target.id === source.id) continue;
        const dy = target.y - source.y;
        const distance = Math.hypot(target.x - source.x, dy * 2);
        if (distance > 0.46 || dy < -0.015) continue;
        const transfer = sourceEnergy * (dy > 0.02 ? 0.80 : 0.54) *
          (1 - distance * 0.36);
        if (transfer > 0.16 && transfer > (energy.get(target.id) || 0) + 0.001) {
          energy.set(target.id, transfer);
          queue.push(target);
        }
      }
    }
    const knocked = pins.filter(pin => (energy.get(pin.id) || 0) >= 0.18).map(pin => pin.id);
    return { knocked, standing: standing.filter(id => !knocked.includes(id)), gutter };
  }

  const api = { BowlingGame, scoreGame, rollMarks, simulateRoll, ballPosition, PIN_LAYOUT };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Bowling = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
