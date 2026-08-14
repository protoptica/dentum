const defaultImage = "./assets/wisdom-tooth-removal/panoramic-demo.jpg";

const state = {
  hasImage: true,
  imageUrl: defaultImage,
  tooth: null,
  guess: null,
  resultVisible: false,
};

const uploadInput = document.querySelector("#xray-upload");
const useExampleButton = document.querySelector("#use-example");
const uploadMessage = document.querySelector("#upload-message");
const image = document.querySelector("#xray-image");
const fileName = document.querySelector("#file-name");
const hint = document.querySelector("#xray-hint");
const showResultButton = document.querySelector("#show-result");
const resultPanel = document.querySelector("#result-panel");
const emptyResult = document.querySelector("#empty-result");
const resultTitle = document.querySelector("#result-title");
const matchBadge = document.querySelector("#match-badge");
const resetButton = document.querySelector("#reset-demo");
const tryAgainButton = document.querySelector("#try-again");
const consultationButton = document.querySelector("#book-consultation");
const consultationDialog = document.querySelector("#consultation-dialog");
const xrayStage = document.querySelector("#xray-stage");

const toothButtons = [...document.querySelectorAll("[data-tooth-choice], [data-tooth-marker]")];
const guessButtons = [...document.querySelectorAll("[data-guess]")];
const steps = [...document.querySelectorAll(".step")];

function setStepStates() {
  const uploadStep = steps.find((step) => step.dataset.step === "upload");
  const toothStep = steps.find((step) => step.dataset.step === "tooth");
  const guessStep = steps.find((step) => step.dataset.step === "guess");

  uploadStep.classList.toggle("is-complete", state.hasImage);
  uploadStep.classList.toggle("is-active", !state.hasImage);
  toothStep.classList.toggle("is-active", state.hasImage && !state.tooth);
  toothStep.classList.toggle("is-complete", Boolean(state.tooth));
  guessStep.classList.toggle("is-active", Boolean(state.tooth));
  guessStep.classList.toggle("is-complete", Boolean(state.guess));
}

function updateControls() {
  toothButtons.forEach((button) => {
    const selected = (button.dataset.toothChoice || button.dataset.toothMarker) === state.tooth;
    button.setAttribute("aria-pressed", String(selected));
  });

  guessButtons.forEach((button) => {
    button.setAttribute("aria-checked", String(button.dataset.guess === state.guess));
  });

  showResultButton.disabled = !(state.hasImage && state.tooth && state.guess);
  hint.textContent = state.tooth ? `Выбран зуб ${state.tooth}` : "Выберите 38 или 48 на снимке";
  setStepStates();
}

function selectTooth(tooth) {
  state.tooth = tooth;
  state.resultVisible = false;
  resultPanel.hidden = true;
  emptyResult.hidden = false;
  updateControls();
}

function selectGuess(guess) {
  state.guess = guess;
  state.resultVisible = false;
  resultPanel.hidden = true;
  emptyResult.hidden = false;
  updateControls();
}

function loadExample() {
  if (state.imageUrl && state.imageUrl.startsWith("blob:")) {
    URL.revokeObjectURL(state.imageUrl);
  }
  state.hasImage = true;
  state.imageUrl = defaultImage;
  image.src = defaultImage;
  image.alt = "Демонстрационный панорамный рентгеновский снимок с нижними зубами мудрости";
  fileName.textContent = "Демонстрационный пример";
  uploadMessage.textContent = "";
  updateControls();
}

function resetDemo({ keepImage = false } = {}) {
  state.tooth = null;
  state.guess = null;
  state.resultVisible = false;
  resultPanel.hidden = true;
  emptyResult.hidden = false;
  if (!keepImage) loadExample();
  updateControls();
}

function handleFile(file) {
  uploadMessage.textContent = "";
  const supportedTypes = ["image/jpeg", "image/png", "image/webp"];
  const maxSize = 15 * 1024 * 1024;

  if (!supportedTypes.includes(file.type)) {
    uploadMessage.textContent = "Нужен файл JPG, PNG или WEBP.";
    uploadInput.value = "";
    return;
  }

  if (file.size > maxSize) {
    uploadMessage.textContent = "Файл больше 15 МБ. Выберите уменьшенную копию.";
    uploadInput.value = "";
    return;
  }

  if (state.imageUrl && state.imageUrl.startsWith("blob:")) {
    URL.revokeObjectURL(state.imageUrl);
  }

  state.imageUrl = URL.createObjectURL(file);
  state.hasImage = true;
  image.src = state.imageUrl;
  image.alt = "Загруженный панорамный снимок";
  fileName.textContent = file.name;
  resetDemo({ keepImage: true });
}

function showResult() {
  if (showResultButton.disabled) return;

  state.resultVisible = true;
  emptyResult.hidden = true;
  resultPanel.hidden = false;
  resultTitle.textContent = `Зуб ${state.tooth}: высокая предполагаемая сложность`;

  const matched = state.guess === "complex";
  matchBadge.textContent = matched ? "Ваш прогноз совпал" : "Система оценила иначе";
  matchBadge.classList.toggle("is-miss", !matched);

  resultPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

toothButtons.forEach((button) => {
  button.addEventListener("click", () => selectTooth(button.dataset.toothChoice || button.dataset.toothMarker));
});

guessButtons.forEach((button) => {
  button.addEventListener("click", () => selectGuess(button.dataset.guess));
});

uploadInput.addEventListener("change", () => {
  const [file] = uploadInput.files;
  if (file) handleFile(file);
});

useExampleButton.addEventListener("click", () => {
  loadExample();
  resetDemo({ keepImage: true });
});

xrayStage.addEventListener("dragover", (event) => {
  event.preventDefault();
  xrayStage.classList.add("is-dragging");
});

xrayStage.addEventListener("dragleave", () => xrayStage.classList.remove("is-dragging"));

xrayStage.addEventListener("drop", (event) => {
  event.preventDefault();
  xrayStage.classList.remove("is-dragging");
  const [file] = event.dataTransfer.files;
  if (file) handleFile(file);
});

showResultButton.addEventListener("click", showResult);
resetButton.addEventListener("click", () => resetDemo());
tryAgainButton.addEventListener("click", () => resetDemo({ keepImage: true }));
consultationButton.addEventListener("click", () => consultationDialog.showModal());

updateControls();

if (new URLSearchParams(window.location.search).get("result") === "1") {
  selectTooth("48");
  selectGuess("complex");
  showResult();
}
