import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { initialState, step, type State } from './simulation';
export type Controls = { running: boolean; score: number; reset: number };
export default function Game({ controls, onStats }: { controls: Controls; onStats: (s: State) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const current = useRef(controls); current.current = controls;
  const callback = useRef(onStats); callback.current = onStats;
  useEffect(() => {
    class BalanceScene extends Phaser.Scene {
      private state = initialState(); private resetId = -1; private reported = 0;
      private drawing!: Phaser.GameObjects.Graphics;
      private keys!: Phaser.Types.Input.Keyboard.CursorKeys;
      private accumulator = 0;
      create() { this.drawing = this.add.graphics(); this.keys = this.input.keyboard!.createCursorKeys(); }
      update(_time: number, delta: number) {
        const c = current.current;
        if (this.resetId !== c.reset) { this.state = initialState(); this.resetId = c.reset; this.accumulator = 0; callback.current(this.state); }
        if (c.running && !this.state.done) {
          this.accumulator += Math.min(delta / 1000, 0.1);
          while (this.accumulator >= 1 / 120) {
            this.state = step(this.state, 1 / 120, c.score, Number(this.keys.right.isDown) - Number(this.keys.left.isDown));
            this.accumulator -= 1 / 120;
          }
        }
        const g = this.drawing; g.clear();
        g.fillStyle(0x142b30); g.fillEllipse(480, 440, 420, 22);
        g.fillStyle(0x29474b); g.fillTriangle(480, 300, 433, 422, 527, 422);
        g.fillStyle(0x3d6063); g.fillTriangle(480, 300, 480, 422, 527, 422);
        const a = this.state.angle, cos = Math.cos(a), sin = Math.sin(a);
        const point = (x: number, y: number) => ({ x: 480 + x * cos - y * sin, y: 300 + x * sin + y * cos });
        const rect = (left: number, right: number, top: number, bottom: number, color: number) => {
          g.fillStyle(color); g.fillPoints([point(left, top), point(right, top), point(right, bottom), point(left, bottom)], true);
        };
        rect(-340, 340, -8, 12, 0xb98b63); rect(-340, 340, -8, -3, 0xe6c49d);
        rect(-51, 51, -11, -8, 0x75e4c1);
        const ball = point(this.state.x * 340, -27);
        g.fillStyle(0x0d2328, 0.35); g.fillCircle(ball.x + 5, ball.y + 7, 19);
        g.fillStyle(0x8ff1d0); g.fillCircle(ball.x, ball.y, 19);
        g.fillStyle(0xd3fff1); g.fillCircle(ball.x - 6, ball.y - 7, 5);
        this.reported += delta;
        if (this.reported >= 100) { callback.current(this.state); this.reported = 0; }
      }
    }
    const game = new Phaser.Game({ type: Phaser.AUTO, parent: host.current!, width: 960, height: 520,
      backgroundColor: '#10272d', scene: BalanceScene, scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH } });
    return () => game.destroy(true);
  }, []);
  return <div className="game" ref={host} role="img" aria-label="Animated ball balancing on a wooden beam. Arrow keys add optional steering." />;
}
