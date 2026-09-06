'use strict';

const services = ['instagram', 'twitter', 'tiktok'];
const serviceLabels = {
  instagram: 'Instagram',
  twitter: 'X/Twitter',
  tiktok: 'TikTok'
};

const notice = document.getElementById('notice');
const form = document.getElementById('settings-form');
const fields = {};
for (const service of services) {
  fields[service] = {
    input: document.getElementById(`${service}-host`),
    error: document.getElementById(`${service}-error`)
  };
}

function setFieldError(service, message) {
  const field = fields[service];
  if (message === null) {
    field.error.hidden = true;
    field.error.textContent = '';
    field.input.setAttribute('aria-invalid', 'false');
    return;
  }
  field.error.textContent = message;
  field.error.hidden = false;
  field.input.setAttribute('aria-invalid', 'true');
}

function clearErrors() {
  notice.hidden = true;
  for (const service of services) {
    setFieldError(service, null);
  }
}

function showNotice(message) {
  notice.textContent = message;
  notice.hidden = false;
}

function setInputValues(values) {
  for (const service of services) {
    fields[service].input.value = values[service];
  }
}

async function loadHosts() {
  const data = await window.fixSettings.getHosts();
  setInputValues(data.hosts);
  if (data.warning !== null) {
    showNotice(data.warning);
  }
  fields[services[0]].input.focus();
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearErrors();

  const hosts = {};
  let firstInvalidService = null;
  for (const service of services) {
    const value = fields[service].input.value;
    if (value.trim().length === 0) {
      setFieldError(
        service,
        `Enter the ${serviceLabels[service]} hostname.`
      );
      firstInvalidService ??= service;
    }
    hosts[service] = value;
  }
  if (firstInvalidService !== null) {
    fields[firstInvalidService].input.focus();
    return;
  }

  const result = await window.fixSettings.saveHosts(hosts);
  if (result.ok) {
    window.close();
    return;
  }
  let focused = false;
  for (const service of services) {
    const message = result.errors[service];
    if (message !== undefined) {
      setFieldError(service, message);
      if (!focused) {
        fields[service].input.focus();
        focused = true;
      }
    }
  }
  if (result.errors.general !== undefined) {
    showNotice(result.errors.general);
  }
});

document.getElementById('restore').addEventListener('click', async () => {
  clearErrors();
  const data = await window.fixSettings.getHosts();
  setInputValues(data.defaults);
  fields[services[0]].input.focus();
});

document.getElementById('cancel').addEventListener('click', () => {
  window.close();
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    window.close();
  }
});

void loadHosts();