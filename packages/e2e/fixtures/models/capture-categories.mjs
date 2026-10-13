import { recordModel } from './events.mjs';

export async function classifyCaptureCategories(input, categories) {
  if (!categories.length) return {};
  await recordModel('classifyCaptureCategories', { input, categories });
  const text = JSON.stringify(input);
  const markers = { credentials: 'E2E_SENSITIVE_CREDENTIAL', personal_info: 'E2E_SENSITIVE_PERSONAL', customer_data: 'E2E_SENSITIVE_CUSTOMER', non_work: 'E2E_NON_WORK' };
  return Object.fromEntries(categories.map(category => [category, text.includes(markers[category])]));
}
