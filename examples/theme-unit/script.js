const button = document.querySelector('[data-editor-id="unit-button"]');
const feedback = document.querySelector('[data-editor-id="unit-feedback"]');

button?.addEventListener('click', () => {
  if (feedback) feedback.textContent = '已触发示例交互。';
});
