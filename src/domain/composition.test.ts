import { describe, expect, it } from 'vitest';
import { blocksForAspect, blockRect, chartBlocks, compositionHasMap, COMPOSITIONS, type CompositionBlock } from './composition';
import type { CanvasAspect } from './infographic';

/**
 * Every composition has to survive every canvas the studio can export. These
 * checks are geometric only: blocks may not overlap, may not leave the canvas
 * and may not collapse to nothing at any aspect.
 */
const ASPECTS: CanvasAspect[] = ['16:9', '1:1', '4:5', '9:16'];

const EPSILON = 0.001;

function overlaps(a: CompositionBlock, b: CompositionBlock) {
  const horizontal = a.x + a.width > b.x + EPSILON && b.x + b.width > a.x + EPSILON;
  const vertical = a.y + a.height > b.y + EPSILON && b.y + b.height > a.y + EPSILON;
  return horizontal && vertical;
}

describe('composition geometry', () => {
  for (const composition of COMPOSITIONS) {
    for (const aspect of ASPECTS) {
      describe(`${composition.id} @ ${aspect}`, () => {
        const blocks = blocksForAspect(composition, aspect);

        it('has at least one block', () => {
          expect(blocks.length).toBeGreaterThan(0);
        });

        it('gives every block a positive size', () => {
          for (const block of blocks) {
            expect(block.width, `${block.id} width`).toBeGreaterThan(0);
            expect(block.height, `${block.id} height`).toBeGreaterThan(0);
          }
        });

        it('keeps every block inside 0..100 on both axes', () => {
          for (const block of blocks) {
            expect(block.x, `${block.id} x`).toBeGreaterThanOrEqual(0);
            expect(block.y, `${block.id} y`).toBeGreaterThanOrEqual(0);
            expect(block.x + block.width, `${block.id} right edge`).toBeLessThanOrEqual(100 + EPSILON);
            expect(block.y + block.height, `${block.id} bottom edge`).toBeLessThanOrEqual(100 + EPSILON);
          }
        });

        it('never overlaps two blocks', () => {
          for (let i = 0; i < blocks.length; i += 1) {
            for (let j = i + 1; j < blocks.length; j += 1) {
              expect(overlaps(blocks[i], blocks[j]), `${blocks[i].id} overlaps ${blocks[j].id}`).toBe(false);
            }
          }
        });

        it('gives every block a unique id', () => {
          expect(new Set(blocks.map((block) => block.id)).size).toBe(blocks.length);
        });

        it('produces a drawable pixel rect on a 1920x1080-scale canvas', () => {
          for (const block of blocks) {
            const rect = blockRect(block, 1920, 1080);
            expect(rect.width, `${block.id} px width`).toBeGreaterThan(0);
            expect(rect.height, `${block.id} px height`).toBeGreaterThan(0);
            expect(rect.x + rect.width).toBeLessThanOrEqual(1920);
            expect(rect.y + rect.height).toBeLessThanOrEqual(1080);
          }
        });
      });
    }
  }
});

describe('blocksForAspect', () => {
  it('falls back to the base blocks when no override exists', () => {
    for (const composition of COMPOSITIONS) {
      for (const aspect of ASPECTS) {
        if (composition.aspectOverrides?.[aspect]) continue;
        expect(blocksForAspect(composition, aspect)).toBe(composition.blocks);
      }
    }
  });

  it('returns the override when one exists', () => {
    for (const composition of COMPOSITIONS) {
      for (const aspect of ASPECTS) {
        const override = composition.aspectOverrides?.[aspect];
        if (!override) continue;
        expect(blocksForAspect(composition, aspect)).toBe(override);
      }
    }
  });

  it('preserves each composition\'s block roster across aspects', () => {
    for (const composition of COMPOSITIONS) {
      const baseIds = [...composition.blocks.map((block) => block.id)].sort();
      for (const aspect of ASPECTS) {
        const ids = [...blocksForAspect(composition, aspect).map((block) => block.id)].sort();
        expect(ids, `${composition.id} @ ${aspect}`).toEqual(baseIds);
      }
    }
  });

  it('keeps the map slot and chart roster stable at every aspect', () => {
    for (const composition of COMPOSITIONS) {
      const hasMap = compositionHasMap(composition);
      const chartCount = chartBlocks(composition).length;
      for (const aspect of ASPECTS) {
        expect(compositionHasMap(composition, aspect), `${composition.id} @ ${aspect} map`).toBe(hasMap);
        expect(chartBlocks(composition, aspect).length, `${composition.id} @ ${aspect} charts`).toBe(chartCount);
      }
    }
  });
});
