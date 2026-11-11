import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import '../src/i18n/index';
import { PrivateText } from '../src/features/quota/components/PrivateText';
import { syncRevealState } from '../src/features/quota/components/revealState';

const EMAIL = 'tiago@example.com';

const render = (text: string, showEmails: boolean) =>
  renderToStaticMarkup(createElement(PrivateText, { text, className: 'name', showEmails }));

describe('quota account email privacy', () => {
  test('masks emails like the timeline does, behind a click-to-reveal button', () => {
    const markup = render(EMAIL, false);
    expect(markup).toMatch(/^<button type="button"[^>]*aria-label="[^"]+"/);
    expect(markup).toContain('>t•••@e•••.com</button>');
    expect(markup).not.toContain(EMAIL);
  });

  test('masks only the email part of a credential file name', () => {
    expect(render(`claude-${EMAIL}.json`, false)).toContain('>claude-t•••@e•••.com.json</button>');
  });

  test('shows plain text when "Show emails" is on', () => {
    expect(render(EMAIL, true)).toBe(`<span class="name" title="${EMAIL}">${EMAIL}</span>`);
  });

  test('"Hide emails" hides again an address revealed by clicking it', () => {
    const revealed = { revealed: true, showEmails: false };
    expect(syncRevealState(revealed, false)).toBe(revealed);
    const shown = syncRevealState(revealed, true);
    expect(syncRevealState(shown, false).revealed).toBe(false);
  });

  test('never masks nicknames', () => {
    expect(render('Tiago account', false)).toBe(
      '<span class="name" title="Tiago account">Tiago account</span>'
    );
  });
});
