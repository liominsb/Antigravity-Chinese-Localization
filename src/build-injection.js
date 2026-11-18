'use strict';

const fs = require('fs');
const path = require('path');
const { dictionary, coreWords } = require('./dictionary');

const DOM_TRANSLATOR_SOURCE_PATH = path.join(__dirname, 'dom-translator.js');

/**
 * Assemble the self-contained browser preload IIFE payload from pure JS source
 * (`src/dom-translator.js`) and JSON-serialized dictionaries (`src/dictionary.js`).
 * Uses functional replacement callbacks to prevent `$` pattern corruption.
 */
function buildDomTranslatorInjection(customDictionary = dictionary, customCoreWords = coreWords) {
  const templateSource = fs.readFileSync(DOM_TRANSLATOR_SOURCE_PATH, 'utf8');
  const dictJson = JSON.stringify(customDictionary, null, 4);
  const coreJson = JSON.stringify(customCoreWords, null, 4);

  if (!templateSource.includes('/* __AGY_DICTIONARY__ */ {}')) {
    throw new Error('dom-translator.js missing /* __AGY_DICTIONARY__ */ {} placeholder');
  }
  if (!templateSource.includes('/* __AGY_CORE_WORDS__ */ {}')) {
    throw new Error('dom-translator.js missing /* __AGY_CORE_WORDS__ */ {} placeholder');
  }

  return templateSource
    .replace('/* __AGY_DICTIONARY__ */ {}', () => dictJson)
    .replace('/* __AGY_CORE_WORDS__ */ {}', () => coreJson)
    .trim();
}

const DOM_TRANSLATOR_INJECTION = buildDomTranslatorInjection();

module.exports = {
  buildDomTranslatorInjection,
  DOM_TRANSLATOR_INJECTION,
  dictionary,
  coreWords
};
