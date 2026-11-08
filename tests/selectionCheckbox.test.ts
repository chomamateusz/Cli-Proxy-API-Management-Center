import { describe, expect, mock, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

mock.module('../src/components/ui/SelectionCheckbox.module.scss', () => ({
  default: {
    root: 'root',
    disabled: 'disabled',
    input: 'input',
    box: 'box',
    boxChecked: 'boxChecked',
    label: 'label',
  },
}));

const { SelectionCheckbox } = await import('../src/components/ui/SelectionCheckbox');

const CHECK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
  ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' +
  ' focusable="false" width="12" height="12"><path d="M20 6 9 17l-5-5"></path></svg>';

const render = (props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(SelectionCheckbox, { onChange: () => {}, ...props } as never));

describe('SelectionCheckbox', () => {
  test('default markup is unchanged', () => {
    expect(render({ checked: true, ariaLabel: 'Pick', title: 'T', label: 'Label' })).toBe(
      '<label class="root" title="T"><input class="input" type="checkbox" aria-label="Pick"' +
        ` checked=""/><span class="box boxChecked">${CHECK_ICON}</span>` +
        '<div class="label">Label</div></label>'
    );
    expect(render({ checked: false, disabled: true })).toBe(
      '<label class="root disabled"><input class="input" type="checkbox" disabled=""/>' +
        '<span class="box"></span></label>'
    );
  });

  test('ariaDisabled keeps the input enabled and focusable', () => {
    const html = render({ checked: false, ariaDisabled: true, ariaLabel: 'Locked' });
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toContain('disabled=""');
    expect(html).toContain('class="root disabled"');
  });

  test('tabIndex is forwarded to the input', () => {
    expect(render({ checked: false, tabIndex: -1 })).toContain(
      '<input class="input" type="checkbox" tabindex="-1"/>'
    );
    expect(render({ checked: false, tabIndex: 0 })).toContain('tabindex="0"');
  });
});
