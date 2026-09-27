import { describe, expect, it } from 'vitest';
import {
  dropBoilerplateSections,
  isBoilerplateHeading,
  isMarkerText,
} from '../../src/extract/boilerplate.js';
import { heading, listItem, paragraph } from '../../src/outline/blocks.js';

describe('isMarkerText', () => {
  it('recognises the leftovers of a template', () => {
    expect(isMarkerText('[edit]')).toBe(true);
    expect(isMarkerText('edit')).toBe(true);
    expect(isMarkerText(' [1] ')).toBe(true);
    expect(isMarkerText('[citation needed]')).toBe(true);
  });

  it('leaves real text alone', () => {
    expect(isMarkerText('')).toBe(false);
    expect(isMarkerText('edit the page')).toBe(false);
    expect(isMarkerText('[1] Surveyor, Plans of the Upper Valley')).toBe(false);
  });
});

describe('isBoilerplateHeading', () => {
  it('matches the usual trailing sections, however they are decorated', () => {
    expect(isBoilerplateHeading('See also')).toBe(true);
    expect(isBoilerplateHeading('References[edit]')).toBe(true);
    expect(isBoilerplateHeading('Notes and references')).toBe(true);
    expect(isBoilerplateHeading('External links')).toBe(true);
    expect(isBoilerplateHeading('参考文献')).toBe(true);
  });

  it('does not match a section that happens to mention them', () => {
    expect(isBoilerplateHeading('References to earlier surveys')).toBe(false);
    expect(isBoilerplateHeading('Origins')).toBe(false);
  });
});

describe('dropBoilerplateSections', () => {
  it('drops the section and everything nested under it', () => {
    const blocks = dropBoilerplateSections([
      heading(2, 'Origins'),
      paragraph('Real content.'),
      heading(2, 'References'),
      listItem(0, 'A. Surveyor, 1873.'),
      heading(3, 'Notes on the citations'),
      paragraph('Still inside the dropped section.'),
    ]);

    expect(blocks).toEqual([
      { type: 'heading', level: 2, text: 'Origins' },
      { type: 'paragraph', text: 'Real content.' },
    ]);
  });

  it('stops cutting at the next heading of the same level or above', () => {
    const blocks = dropBoilerplateSections([
      heading(2, 'References'),
      listItem(0, 'a citation'),
      heading(2, 'Tools'),
      paragraph('Kept.'),
    ]);

    expect(blocks).toEqual([
      { type: 'heading', level: 2, text: 'Tools' },
      { type: 'paragraph', text: 'Kept.' },
    ]);
  });

  it('leaves a document without such sections untouched', () => {
    const blocks = [heading(2, 'Origins'), paragraph('Text.')];
    expect(dropBoilerplateSections(blocks)).toEqual(blocks);
  });
});
