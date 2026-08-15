const defaultImage = "./assets/wisdom-tooth-removal/panoramic-demo.jpg";
const modelPath = "./assets/models/dental-panoramic-yolo11n.onnx";
const modelSize = 640;
const confidenceThreshold = 0.45;
const complexityApiUrl = window.DENTUM_CONFIG?.complexityApiUrl?.trim() || "";

let modelSessionPromise = null;

const state = {
  hasImage: true,
  imageUrl: defaultImage,
  tooth: null,
  guess: null,
  resultVisible: false,
  analyzing: false,
  detecting: false,
  detectionComplete: false,
  imageRevision: 0,
  detections: { 38: null, 48: null },
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
const modelStatus = document.querySelector("#model-status");
const reasonList = document.querySelector("#result-reason-list");
const markerButtons = [...document.querySelectorAll("[data-tooth-marker]")];

const toothButtons = [...document.querySelectorAll("[data-tooth-choice], [data-tooth-marker]")];
const guessButtons = [...document.querySelectorAll("[data-guess]")];
const steps = [...document.querySelectorAll(".step")];

function setStepStates() {
  const uploadStep = steps.find((step) => step.dataset.step === "upload");
  const toothStep = steps.find((step) => step.dataset.step === "tooth");
  const guessStep = steps.find((step) => step.dataset.step === "guess");

  uploadStep.classList.toggle("is-complete", state.hasImage);
  uploadStep.classList.toggle("is-active", !state.hasImage);
  const hasLocatedTooth = Boolean(state.detections["38"] || state.detections["48"]);
  const selectedDetection = state.tooth ? state.detections[state.tooth] : null;
  toothStep.classList.toggle("is-active", state.hasImage && state.detectionComplete && hasLocatedTooth && !state.tooth);
  toothStep.classList.toggle("is-complete", Boolean(state.tooth));
  guessStep.classList.toggle("is-active", Boolean(selectedDetection));
  guessStep.classList.toggle("is-complete", Boolean(state.guess));
}

function updateControls() {
  toothButtons.forEach((button) => {
    const tooth = button.dataset.toothChoice || button.dataset.toothMarker;
    const selected = tooth === state.tooth;
    button.setAttribute("aria-pressed", String(selected));
    button.disabled = state.detecting || !state.detectionComplete || !state.detections[tooth];
  });

  const selectedDetection = state.tooth ? state.detections[state.tooth] : null;
  guessButtons.forEach((button) => {
    button.setAttribute("aria-checked", String(button.dataset.guess === state.guess));
    button.disabled = state.detecting || state.analyzing || !selectedDetection;
  });

  showResultButton.disabled = state.detecting || state.analyzing || !(state.hasImage && selectedDetection && state.guess);
  const hasLocatedTooth = Boolean(state.detections["38"] || state.detections["48"]);
  hint.textContent = state.detecting
    ? "Ищем зубы 38 и 48…"
    : !state.detectionComplete
      ? "Сначала дождитесь результата первой модели"
    : state.tooth
      ? `Выбран зуб ${state.tooth}`
      : hasLocatedTooth
        ? "Выберите найденный зуб на снимке"
        : "Нижние восьмёрки не найдены. Загрузите другой панорамный снимок.";
  setStepStates();
}

function selectTooth(tooth) {
  if (!state.detectionComplete || !state.detections[tooth]) return;
  state.tooth = tooth;
  state.resultVisible = false;
  resultPanel.hidden = true;
  emptyResult.hidden = false;
  updateControls();
}

function selectGuess(guess) {
  if (!state.tooth || !state.detections[state.tooth]) return;
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
  state.imageRevision += 1;
  state.detectionComplete = false;
  state.detections = { 38: null, 48: null };
  resetMarkerPositions();
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

async function handleFile(file) {
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
  state.imageRevision += 1;
  state.detectionComplete = false;
  state.detections = { 38: null, 48: null };
  image.src = state.imageUrl;
  image.alt = "Загруженный панорамный снимок";
  fileName.textContent = file.name;
  resetDemo({ keepImage: true });
  await detectTeethOnCurrentImage();
}

function waitForImage() {
  if (image.complete && image.naturalWidth) return Promise.resolve();
  return new Promise((resolve, reject) => {
    image.addEventListener("load", resolve, { once: true });
    image.addEventListener("error", () => reject(new Error("Не удалось прочитать снимок.")), { once: true });
  });
}

function prepareInputTensor() {
  const canvas = document.createElement("canvas");
  canvas.width = modelSize;
  canvas.height = modelSize;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const scale = Math.min(modelSize / image.naturalWidth, modelSize / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  const offsetX = (modelSize - width) / 2;
  const offsetY = (modelSize - height) / 2;

  context.fillStyle = "#000";
  context.fillRect(0, 0, modelSize, modelSize);
  context.drawImage(image, offsetX, offsetY, width, height);

  const pixels = context.getImageData(0, 0, modelSize, modelSize).data;
  const planeSize = modelSize * modelSize;
  const input = new Float32Array(planeSize * 3);
  for (let index = 0; index < planeSize; index += 1) {
    input[index] = pixels[index * 4] / 255;
    input[planeSize + index] = pixels[index * 4 + 1] / 255;
    input[planeSize * 2 + index] = pixels[index * 4 + 2] / 255;
  }
  return {
    tensor: new ort.Tensor("float32", input, [1, 3, modelSize, modelSize]),
    transform: { width, height, offsetX, offsetY },
  };
}

async function getModelSession() {
  if (!window.ort) throw new Error("Библиотека модели не загрузилась.");
  if (!modelSessionPromise) {
    ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";
    modelSessionPromise = ort.InferenceSession.create(modelPath, { executionProviders: ["wasm"] });
  }
  return modelSessionPromise;
}

function parseLowerWisdomTeeth(output, transform) {
  const [, first, second] = output.dims;
  const attributesFirst = first <= second;
  const attributeCount = attributesFirst ? first : second;
  const detectionCount = attributesFirst ? second : first;
  if (attributeCount < 7) throw new Error("Неожиданный формат ответа модели.");

  const valueAt = (attribute, detection) => (
    attributesFirst
      ? output.data[attribute * detectionCount + detection]
      : output.data[detection * attributeCount + attribute]
  );

  const detections = { 38: null, 48: null };
  for (let detection = 0; detection < detectionCount; detection += 1) {
    const confidence = valueAt(6, detection);
    if (confidence < confidenceThreshold) continue;
    const centerX = valueAt(0, detection);
    const centerY = valueAt(1, detection);
    const boxWidth = valueAt(2, detection);
    const boxHeight = valueAt(3, detection);
    const normalizedX = (centerX - transform.offsetX) / transform.width;
    const normalizedY = (centerY - transform.offsetY) / transform.height;
    const normalizedWidth = boxWidth / transform.width;
    const normalizedHeight = boxHeight / transform.height;
    if (normalizedX < 0 || normalizedX > 1 || normalizedY < 0.48 || normalizedY > 1) continue;

    const tooth = normalizedX < 0.5 ? "48" : "38";
    const current = detections[tooth];
    if (!current || confidence > current.confidence) {
      detections[tooth] = {
        confidence,
        x: normalizedX,
        y: normalizedY,
        width: normalizedWidth,
        height: normalizedHeight,
      };
    }
  }
  return detections;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function getMarkerAnchor(detection) {
  return {
    x: clamp(detection.x, 0.04, 0.96),
    y: clamp(detection.y + detection.height * 0.5 + 0.035, 0.12, 0.88),
  };
}

function normalizedImagePointToStage(point) {
  const stageWidth = xrayStage.clientWidth;
  const stageHeight = xrayStage.clientHeight;
  if (!stageWidth || !stageHeight || !image.naturalWidth || !image.naturalHeight) return point;

  const coverScale = Math.max(stageWidth / image.naturalWidth, stageHeight / image.naturalHeight);
  const renderedWidth = image.naturalWidth * coverScale;
  const renderedHeight = image.naturalHeight * coverScale;
  const offsetX = (stageWidth - renderedWidth) / 2;
  const offsetY = (stageHeight - renderedHeight) / 2;
  return {
    x: (offsetX + point.x * renderedWidth) / stageWidth,
    y: (offsetY + point.y * renderedHeight) / stageHeight,
  };
}

function positionMarkers() {
  markerButtons.forEach((button) => {
    const tooth = button.dataset.toothMarker;
    const detection = state.detections[tooth];
    button.classList.toggle("is-unlocated", !detection);
    button.classList.toggle("is-located", Boolean(detection));
    if (!detection) {
      button.style.removeProperty("left");
      button.style.removeProperty("top");
      button.title = `Модель не нашла зуб ${tooth}`;
      return;
    }

    const stagePoint = normalizedImagePointToStage(getMarkerAnchor(detection));
    button.style.left = `${clamp(stagePoint.x * 100, 4, 96)}%`;
    button.style.top = `${clamp(stagePoint.y * 100, 8, 92)}%`;
    button.title = `Зуб ${tooth}, уверенность детекции ${Math.round(detection.confidence * 100)}%`;
  });
}

function resetMarkerPositions() {
  markerButtons.forEach((button) => {
    button.classList.remove("is-located", "is-unlocated");
    button.style.removeProperty("left");
    button.style.removeProperty("top");
    button.removeAttribute("title");
  });
}

function describeDetections(detections) {
  const found = ["48", "38"].filter((tooth) => detections[tooth]);
  if (!found.length) return "Первая модель не нашла нижние восьмёрки с уверенностью выше 45%. Загрузите другой панорамный снимок.";
  const details = found.map((tooth) => `${tooth} (${Math.round(detections[tooth].confidence * 100)}%)`).join(" и ");
  const suffix = found.length === 2 ? "Круги перемещены к найденным зубам." : "Продолжить можно только с найденным зубом.";
  return `Первая модель нашла ${details}. ${suffix}`;
}

async function detectTeethOnCurrentImage() {
  const revision = state.imageRevision;
  state.detecting = true;
  state.detectionComplete = false;
  xrayStage.classList.add("is-detecting");
  modelStatus.textContent = "Первая модель ищет нижние восьмёрки…";
  hint.textContent = "Ищем зубы 38 и 48…";
  updateControls();

  try {
    await waitForImage();
    const session = await getModelSession();
    const prepared = prepareInputTensor();
    const outputs = await session.run({ [session.inputNames[0]]: prepared.tensor });
    if (revision !== state.imageRevision) return;
    state.detections = parseLowerWisdomTeeth(outputs[session.outputNames[0]], prepared.transform);
    state.detectionComplete = true;
    positionMarkers();
    modelStatus.textContent = describeDetections(state.detections);
  } catch (error) {
    if (revision !== state.imageRevision) return;
    modelSessionPromise = null;
    state.detections = { 38: null, 48: null };
    state.detectionComplete = true;
    resetMarkerPositions();
    modelStatus.textContent = `Первая модель не запустилась: ${error.message}`;
  } finally {
    if (revision === state.imageRevision) {
      state.detecting = false;
      xrayStage.classList.remove("is-detecting");
      updateControls();
      positionMarkers();
    }
  }
}

function makeDistribution(detection) {
  if (!detection) throw new Error("Первая модель не нашла выбранный зуб");
  const complex = Math.round(25 + detection.confidence * 55);
  const medium = Math.round(45 - detection.confidence * 25);
  return { simple: 100 - complex - medium, medium, complex };
}

function makeComplexityCrop(detection, tooth) {
  const cropWidth = clamp(Math.max(0.38, detection.width * 4.2), 0.38, 0.62);
  const cropHeight = clamp(Math.max(0.5, detection.height * 3.2), 0.5, 0.72);
  const directionToSecondMolar = tooth === "48" ? 1 : -1;
  const centerX = detection.x + directionToSecondMolar * cropWidth * 0.14;
  const centerY = detection.y + cropHeight * 0.02;
  const cropX = clamp(centerX - cropWidth / 2, 0, 1 - cropWidth);
  const cropY = clamp(centerY - cropHeight / 2, 0, 1 - cropHeight);

  const sourceX = cropX * image.naturalWidth;
  const sourceY = cropY * image.naturalHeight;
  const sourceWidth = cropWidth * image.naturalWidth;
  const sourceHeight = cropHeight * image.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 768;
  const context = canvas.getContext("2d");
  const scale = Math.min(canvas.width / sourceWidth, canvas.height / sourceHeight);
  const targetWidth = sourceWidth * scale;
  const targetHeight = sourceHeight * scale;

  context.fillStyle = "#000";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    (canvas.width - targetWidth) / 2,
    (canvas.height - targetHeight) / 2,
    targetWidth,
    targetHeight,
  );
  return canvas.toDataURL("image/jpeg", 0.84);
}

function roundDistribution(distribution) {
  const keys = ["simple", "medium", "complex"];
  const values = keys.map((key) => Math.max(0, Number(distribution[key]) || 0));
  const total = values.reduce((sum, value) => sum + value, 0) || 1;
  const exact = values.map((value) => (value / total) * 100);
  const rounded = exact.map(Math.floor);
  let remainder = 100 - rounded.reduce((sum, value) => sum + value, 0);
  const order = exact.map((value, index) => ({ index, fraction: value - rounded[index] }))
    .sort((a, b) => b.fraction - a.fraction);
  for (let index = 0; index < remainder; index += 1) rounded[order[index].index] += 1;
  return Object.fromEntries(keys.map((key, index) => [key, rounded[index]]));
}

async function requestComplexityEstimate(detection) {
  if (!complexityApiUrl) return null;
  const response = await fetch(complexityApiUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tooth: state.tooth,
      image: makeComplexityCrop(detection, state.tooth),
    }),
    signal: AbortSignal.timeout(30000),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.detail || payload.error || "Вторая модель не ответила");
  if (!payload.distribution || !payload.features) throw new Error("Неполный ответ второй модели");
  if (payload.features.image_quality === "invalid") throw new Error("Модель не смогла прочитать фрагмент");
  return payload;
}

function renderDistribution(distribution) {
  Object.entries(distribution).forEach(([level, value]) => {
    const row = document.querySelector(`.probability[data-level="${level}"]`);
    row.querySelector("i").style.setProperty("--value", `${value}%`);
    row.querySelector("strong").textContent = `${value}%`;
  });
}

function mostLikelyLabel(distribution, labels) {
  return Object.entries(distribution).sort((a, b) => b[1] - a[1])[0]?.[0] || labels[0];
}

function renderReasons(detection, complexityResult = null) {
  const featureLabels = {
    mesioangular: "мезиальный наклон",
    horizontal: "горизонтальное положение",
    vertical: "вертикальное положение",
    distoangular: "дистальный наклон",
  };
  const reasons = complexityResult
    ? [
        `Угол: ${featureLabels[mostLikelyLabel(complexityResult.features.angulation, Object.keys(featureLabels))]}`,
        `Глубина: уровень ${mostLikelyLabel(complexityResult.features.depth, ["A", "B", "C"])}`,
        `Отношение к ветви: класс ${mostLikelyLabel(complexityResult.features.ramus, ["I", "II", "III"])}`,
        ...complexityResult.features.evidence.slice(0, 2),
      ]
    : [
        `Детектор нашёл ретинированный зуб: уверенность ${Math.round(detection.confidence * 100)}%`,
        `Объект найден в зоне зуба ${state.tooth}`,
        "Вторая модель пока не подключена, используется резервная эвристика",
      ];
  reasonList.replaceChildren(...reasons.map((reason) => {
    const item = document.createElement("li");
    const marker = document.createElement("span");
    marker.setAttribute("aria-hidden", "true");
    item.append(marker, document.createTextNode(reason));
    return item;
  }));
}

async function showResult() {
  if (showResultButton.disabled) return;
  state.analyzing = true;
  showResultButton.textContent = "Считаем оценку…";
  updateControls();

  try {
    const detection = state.detections[state.tooth];
    if (!detection) {
      modelStatus.textContent = "Первая модель не нашла выбранный зуб. Загрузите другой панорамный снимок.";
      return;
    }
    let complexityResult = null;
    let secondModelError = null;
    if (detection && complexityApiUrl) {
      modelStatus.textContent = "Вторая модель оценивает угол, глубину и отношение к ветви…";
      try {
        complexityResult = await requestComplexityEstimate(detection);
      } catch (error) {
        secondModelError = error;
      }
    }
    const distribution = complexityResult
      ? roundDistribution(complexityResult.distribution)
      : makeDistribution(detection);
    const predicted = Object.entries(distribution).sort((a, b) => b[1] - a[1])[0][0];
    const labels = { simple: "простое", medium: "среднее", complex: "сложное" };

    state.resultVisible = true;
    emptyResult.hidden = true;
    resultPanel.hidden = false;
    resultTitle.textContent = `Зуб ${state.tooth}: игровая оценка — ${labels[predicted]} удаление`;
    renderDistribution(distribution);
    renderReasons(detection, complexityResult);

    const matched = state.guess === predicted;
    matchBadge.textContent = matched ? "Ваш прогноз совпал" : "Система оценила иначе";
    matchBadge.classList.toggle("is-miss", !matched);
    modelStatus.textContent = complexityResult
      ? `Вторая модель: индекс ${complexityResult.mostLikely.score}, качество фрагмента ${complexityResult.features.image_quality}.`
      : secondModelError
        ? `Вторая модель недоступна: ${secondModelError.message}. Использована резервная эвристика.`
        : `Первая модель нашла зуб ${state.tooth} с уверенностью ${Math.round(detection.confidence * 100)}%. Вторая модель пока не подключена.`;
    resultPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (error) {
    modelSessionPromise = null;
    modelStatus.textContent = `Ошибка модели: ${error.message}`;
  } finally {
    state.analyzing = false;
    showResultButton.textContent = "Показать игровую оценку";
    updateControls();
  }
}

toothButtons.forEach((button) => {
  button.addEventListener("click", () => selectTooth(button.dataset.toothChoice || button.dataset.toothMarker));
});

guessButtons.forEach((button) => {
  button.addEventListener("click", () => selectGuess(button.dataset.guess));
});

uploadInput.addEventListener("change", async () => {
  const [file] = uploadInput.files;
  if (file) await handleFile(file);
});

useExampleButton.addEventListener("click", async () => {
  loadExample();
  resetDemo({ keepImage: true });
  await detectTeethOnCurrentImage();
});

xrayStage.addEventListener("dragover", (event) => {
  event.preventDefault();
  xrayStage.classList.add("is-dragging");
});

xrayStage.addEventListener("dragleave", () => xrayStage.classList.remove("is-dragging"));

xrayStage.addEventListener("drop", async (event) => {
  event.preventDefault();
  xrayStage.classList.remove("is-dragging");
  const [file] = event.dataTransfer.files;
  if (file) await handleFile(file);
});

showResultButton.addEventListener("click", () => showResult());
resetButton.addEventListener("click", async () => {
  resetDemo();
  await detectTeethOnCurrentImage();
});
tryAgainButton.addEventListener("click", () => resetDemo({ keepImage: true }));
consultationButton.addEventListener("click", () => consultationDialog.showModal());
image.addEventListener("load", positionMarkers);
new ResizeObserver(positionMarkers).observe(xrayStage);

updateControls();

(async () => {
  await detectTeethOnCurrentImage();
  if (new URLSearchParams(window.location.search).get("result") !== "1") return;
  const detectedTooth = state.detections["48"] ? "48" : state.detections["38"] ? "38" : null;
  if (!detectedTooth) return;
  selectTooth(detectedTooth);
  selectGuess("complex");
  await showResult();
})();
