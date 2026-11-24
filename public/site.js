import { montageFrame, montageSheetCount, montageSheetSide, scrollProgress, stageAt, stagePosition } from './montage.js';

const products = {
  arched: {
    title: 'Арочная',
    description: 'Свод образует плавную дугу. При выборе модели стоит учесть высоту растений у стен, ширину прохода и место для дверей.'
  },
  pointed: {
    title: 'Каплевидная',
    description: 'Конёк даёт больше высоты в центре. Для участка с большим количеством снега обсудите с бригадой паспортную нагрузку каркаса и схему крепления.'
  },
  gable: {
    title: 'Прямостенная',
    description: 'У вертикальных стен удобно размещать полки, подвязки и высокие растения. Проверьте, сколько места нужно для прохода и открывания дверей.'
  }
};

const menu = document.querySelector('.menu-toggle');
const nav = document.getElementById('main-nav');
function closeMenu() {
  menu.setAttribute('aria-expanded', 'false');
  nav.classList.remove('nav-open');
}
menu.addEventListener('click', () => {
  const open = menu.getAttribute('aria-expanded') === 'false';
  menu.setAttribute('aria-expanded', String(open));
  nav.classList.toggle('nav-open', open);
});
nav.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && nav.classList.contains('nav-open')) {
    closeMenu();
    menu.focus();
  }
});

let sending = false;
for (const dialog of document.querySelectorAll('dialog')) {
  function close() {
    if (dialog.id !== 'lead-dialog' || !sending) dialog.close();
  }
  dialog.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', close));
  dialog.addEventListener('cancel', event => {
    if (dialog.id === 'lead-dialog' && sending) event.preventDefault();
  });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rectangle = dialog.getBoundingClientRect();
    if (event.clientX < rectangle.left || event.clientX > rectangle.right ||
        event.clientY < rectangle.top || event.clientY > rectangle.bottom) close();
  });
}

const productDialog = document.querySelector('#product-dialog');
const leadDialog = document.querySelector('#lead-dialog');
const leadForm = document.querySelector('#lead-form');
const leadStatus = document.querySelector('#lead-status');
const leadSuccess = document.querySelector('#lead-success');
const leadModel = document.querySelector('#lead-model');
const leadTitle = document.querySelector('#lead-title');
const leadInstruction = document.querySelector('#lead-instruction');
const portfolio = document.body.hasAttribute('data-portfolio');
let selectedProduct = '';
let requestedProduct = '';
let previousRequest;

if (portfolio) {
  leadInstruction.textContent = 'Демо для портфолио. Можно подставить тестовые данные.';
  leadForm.querySelector('.check').hidden = true;
  leadForm.elements.consent.required = false;
  leadForm.querySelector('[type="submit"]').textContent = 'Отправить тестовую заявку';
  document.querySelector('#footer-description').textContent = 'Демо для портфолио';
  document.querySelector('#privacy-explanation').textContent = 'Демо показывает процесс оформления заявки. Данные формы остаются в текущем окне.';
  document.querySelector('#privacy-preview').hidden = true;
  const fillDemo = document.querySelector('#fill-demo');
  fillDemo.hidden = false;
  fillDemo.addEventListener('click', () => {
    leadForm.elements.phone.value = '+7 (000) 000-00-00';
    leadForm.elements.locality.value = 'Елизово';
    leadForm.elements.note.value = 'Теплица для участка. Демонстрационный пример.';
  });
}

function openLead(model = '') {
  requestedProduct = model;
  leadForm.hidden = false;
  leadSuccess.hidden = true;
  leadStatus.hidden = true;
  leadInstruction.hidden = false;
  leadTitle.textContent = 'Рассчитать стоимость';
  leadModel.hidden = !model;
  leadModel.textContent = model ? 'Теплица: ' + products[model].title : '';
  leadDialog.showModal();
  leadForm.elements.phone.focus();
}

document.querySelectorAll('[data-open-lead]').forEach(button => {
  button.addEventListener('click', () => openLead());
});
document.querySelectorAll('[data-product]').forEach(button => {
  button.addEventListener('click', () => {
    selectedProduct = button.dataset.product;
    const product = products[selectedProduct];
    document.querySelector('#product-title').textContent = product.title;
    document.querySelector('#product-description').textContent = product.description;
    document.querySelector('#product-picture').src = './media/' + selectedProduct + '.svg';
    productDialog.showModal();
  });
});
document.querySelector('#product-request').addEventListener('click', () => {
  productDialog.close();
  openLead(selectedProduct);
});
document.querySelector('[data-open-privacy]').addEventListener('click', () => {
  document.querySelector('#privacy-dialog').showModal();
});

function showLeadConfirmation(id, title, explanation) {
  leadTitle.textContent = title;
  document.querySelector('#lead-id').textContent = id.slice(0, 8);
  document.querySelector('#lead-confirmation').textContent = explanation;
  leadForm.reset();
  leadForm.hidden = true;
  leadModel.hidden = true;
  leadInstruction.hidden = true;
  leadSuccess.hidden = false;
  leadSuccess.querySelector('button').focus();
}

leadForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (sending) return;
  if (portfolio) {
    showLeadConfirmation(crypto.randomUUID(), 'Тестовая заявка оформлена', 'Работа формы показана. Данные остались в этом окне.');
    return;
  }
  const submit = leadForm.querySelector('[type="submit"]');
  const data = new FormData(leadForm);
  const body = JSON.stringify({
    phone: data.get('phone'),
    locality: data.get('locality'),
    note: data.get('note'),
    model: requestedProduct,
    consent: data.has('consent')
  });
  if (previousRequest?.body !== body) previousRequest = { body, key: crypto.randomUUID() };
  sending = true;
  submit.disabled = true;
  submit.textContent = 'Отправляем…';
  leadStatus.hidden = true;
  try {
    const response = await fetch('/api/leads', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': previousRequest.key },
      body,
      signal: AbortSignal.timeout(14_000)
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 409) previousRequest = undefined;
      throw new Error(result.error || 'Не удалось отправить заявку.');
    }
    previousRequest = undefined;
    showLeadConfirmation(result.id, 'Заявка сохранена', result.mode === 'preview'
      ? 'Это локальный предпросмотр. Заявка сохранена в тестовой базе.'
      : 'Свяжемся с вами по указанному телефону.');
  } catch (error) {
    leadStatus.textContent = error instanceof TypeError || error.name === 'TimeoutError'
      ? 'Проверьте соединение и попробуйте ещё раз.'
      : error.message;
    leadStatus.hidden = false;
  } finally {
    sending = false;
    submit.disabled = false;
    submit.textContent = 'Отправить заявку';
  }
});

const mapButton = document.querySelector('#open-map');
mapButton.addEventListener('click', () => {
  const map = mapButton.closest('.map');
  const frame = document.createElement('iframe');
  frame.title = 'Камчатский край на Яндекс Картах';
  frame.src = 'https://yandex.ru/map-widget/v1/?ll=158.65%2C53.02&z=7';
  frame.referrerPolicy = 'no-referrer';
  map.prepend(frame);
  mapButton.hidden = true;
  map.querySelector('a').focus();
});

const mount = document.querySelector('[data-mount]');
const still = document.getElementById('mount-still');
const portraitSource = document.getElementById('mount-portrait');
const canvas = document.getElementById('mount-sequence');
const painter = canvas.getContext('2d', { alpha: false });
const videoDialog = document.getElementById('montage-dialog');
const video = document.getElementById('mount-video');
const stages = [...mount.querySelectorAll('[data-stage]')];
const caption = mount.querySelector('[data-caption]');
const stageLabels = ['Размечаем площадку', 'Ставим основание', 'Собираем каркас', 'Крепим покрытие', 'Теплица готова'];
const stageDescriptions = [
  'Двое монтажников размечают площадку на участке',
  'Монтажники устанавливают основание',
  'Монтажники собирают металлический каркас',
  'Монтажник крепит прозрачное покрытие',
  'Монтажник проверяет дверь готовой теплицы'
];
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const portrait = matchMedia('(max-aspect-ratio: 4/5)');
const sheets = new Map();
let current = 0;
let nearMontage = false;
let paintedFrame = '';

document.getElementById('watch-montage').addEventListener('click', () => {
  videoDialog.showModal();
  video.play().catch(() => {
    // The controls remain available if the browser requests another gesture.
  });
});
videoDialog.addEventListener('close', () => video.pause());

function showStage(index) {
  if (current === index) return;
  current = index;
  stages.forEach((stage, number) => stage.setAttribute('aria-pressed', String(number === current)));
  caption.textContent = stageLabels[index];
  portraitSource.srcset = './media/install-portrait-' + (index + 1) + '.webp';
  still.src = './media/install-' + (index + 1) + '.webp';
  still.alt = stageDescriptions[index];
}

function frameSheet(index) {
  if (sheets.has(index)) return sheets.get(index);
  const image = new Image();
  image.decoding = 'async';
  image.onload = scrollMount;
  const format = portrait.matches ? 'portrait' : 'wide';
  image.src = './media/montage-frames/' + format + '-' + index + '.webp';
  sheets.set(index, image);
  return image;
}

function paintMontage(progress) {
  if (!nearMontage || !painter) return;
  const { sheet, column, row } = montageFrame(progress);
  const image = frameSheet(sheet);
  for (const index of sheets.keys()) {
    if (Math.abs(index - sheet) > 1) sheets.delete(index);
  }
  if (!image.complete || !image.naturalWidth) {
    canvas.hidden = true;
    return;
  }

  const key = sheet + ':' + column + ':' + row;
  if (paintedFrame !== key) {
    const width = image.naturalWidth / montageSheetSide;
    const height = image.naturalHeight / montageSheetSide;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    painter.drawImage(image, column * width, row * height, width, height, 0, 0, width, height);
    paintedFrame = key;
  }
  canvas.hidden = false;
  if (sheet + 1 < montageSheetCount) frameSheet(sheet + 1);
  if (sheet > 0) frameSheet(sheet - 1);
}

function scrollMount() {
  if (motion.matches) return;
  const area = mount.getBoundingClientRect();
  const pinnedHeight = mount.firstElementChild.offsetHeight;
  const travel = area.height - pinnedHeight;
  document.body.classList.toggle('mount-in-view', area.top <= 1 && area.bottom >= pinnedHeight - 1);
  const progress = scrollProgress(area.top, travel);
  showStage(stageAt(progress));
  paintMontage(progress);
}

stages.forEach((button, index) => button.addEventListener('click', () => {
  if (motion.matches) {
    showStage(index);
    return;
  }
  const area = mount.getBoundingClientRect();
  const travel = area.height - mount.firstElementChild.offsetHeight;
  window.scrollTo({ top: area.top + window.scrollY + travel * stagePosition(index), behavior: 'instant' });
  scrollMount();
}));
const montageObserver = new IntersectionObserver(([entry]) => {
  if (!entry.isIntersecting) return;
  nearMontage = true;
  scrollMount();
  montageObserver.disconnect();
}, { rootMargin: '500px' });
function onMotionChange() {
  if (motion.matches) {
    canvas.hidden = true;
    document.body.classList.remove('mount-in-view');
  }
  scrollMount();
}
motion.addEventListener('change', onMotionChange);
portrait.addEventListener('change', () => {
  sheets.clear();
  paintedFrame = '';
  canvas.hidden = true;
  scrollMount();
});
window.addEventListener('scroll', scrollMount, { passive: true });
window.addEventListener('resize', scrollMount);
montageObserver.observe(mount);
onMotionChange();
