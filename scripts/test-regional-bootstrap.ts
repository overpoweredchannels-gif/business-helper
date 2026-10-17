import assert from 'node:assert/strict';
import {LANGUAGE_BOOTSTRAP_SCRIPT} from '../src/lib/regional/settings';

function run(cookie: string) {
  const documentElement = {lang: 'en', dir: 'ltr'};
  const document = {documentElement, cookie};
  new Function('document', LANGUAGE_BOOTSTRAP_SCRIPT)(document);
  return documentElement;
}

assert.deepEqual(run('tradeos-ui-language=ur'), {lang: 'ur', dir: 'rtl'});
assert.deepEqual(run('tradeos-ui-language=es'), {lang: 'es', dir: 'ltr'});
assert.deepEqual(run('tradeos-ui-language=it'), {lang: 'it', dir: 'ltr'});
assert.deepEqual(run('other=1; tradeos-ui-language=ur'), {lang: 'ur', dir: 'rtl'});
assert.deepEqual(run('tradeos-ui-language=ur; other=1'), {lang: 'ur', dir: 'rtl'});
// No cookie, empty, or garbage → untouched (React provider owns the default).
assert.deepEqual(run(''), {lang: 'en', dir: 'ltr'});
assert.deepEqual(run('tradeos-ui-language=xx'), {lang: 'en', dir: 'ltr'});
assert.deepEqual(run('tradeos-ui-language='), {lang: 'en', dir: 'ltr'});
console.log('PASS pre-paint language bootstrap: ur/es/it cookies, ordering, and invalid values.');
