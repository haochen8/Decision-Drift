const MAX_ISSUES = 8;
const ISSUE_KEY = /^[A-Z][A-Z0-9_]{0,127}-[1-9]\d{0,18}$/;

function parseIssueKeys(value) {
  const invalid = message => { const error = new Error(message); error.code = 'INVALID_SELECTION'; throw error; };
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_ISSUES) {
    invalid('Choose between one and eight issues from this project.');
  }
  const keys = value.map(key => {
    if (typeof key !== 'string' || key.length > 148 || !ISSUE_KEY.test(key.trim().toUpperCase())) {
      invalid('Enter issue keys such as PROJ-12, separated by commas or new lines.');
    }
    return key.trim().toUpperCase();
  });
  if (new Set(keys).size !== keys.length) invalid('Enter each issue key once. Remove duplicate keys before checking.');
  return keys;
}

module.exports = { MAX_ISSUES, ISSUE_KEY, parseIssueKeys };
