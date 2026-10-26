import { api } from "./auth.js";
import { setImageSource } from "./image-sources.js";
import { prepareProfileUpload } from "./profile-appearance.js";
export function createCardImageEditor(
  doc,
  {
    api: request = api,
    prepare: prepare = prepareProfileUpload,
    onChange = () => {},
    onError = () => {},
  } = {},
) {
  const $ = (id) => doc.getElementById(id),
    input = $("upload-card-image"),
    preview = $("card-image-preview"),
    status = $("card-image-status"),
    dialog = $("card-image-gallery"),
    grid = $("card-image-grid"),
    more = $("more-card-images"),
    search = $("card-image-search"),
    galleryStatus = $("card-gallery-status");
  let generation = 0,
    page = 0,
    requestVersion = 0,
    timer;
  const renderPreview = (url) => {
    preview.hidden = !url;
    if (url) setImageSource(preview, url, true);
    else preview.removeAttribute("src");
  };
  const apply = (url) => {
    const card = JSON.parse($("card-json").value);
    card.imgURL = url;
    $("card-json").value = JSON.stringify(card, null, 2);
    renderPreview(url);
    status.textContent = "Imagem aplicada ao rascunho. Valide e salve a carta.";
    onChange(card);
  };
  async function load(append = false) {
    const version = ++requestVersion,
      nextPage = append ? page + 1 : 0;
    if (!append) grid.replaceChildren();
    more.disabled = true;
    galleryStatus.textContent = "Carregando imagens…";
    try {
      const result = await request(
        "/admin/card-images?page=" +
          nextPage +
          "&q=" +
          encodeURIComponent(search.value.trim()),
      );
      if (version !== requestVersion || !dialog.open) return;
      page = nextPage;
      for (const image of result.images) {
        if ([...grid.children].some((c) => c.dataset.url === image.url))
          continue;
        const button = doc.createElement("button"),
          art = doc.createElement("img"),
          caption = doc.createElement("span");
        button.type = "button";
        button.className = "card-image-option";
        button.dataset.url = image.url;
        art.alt = "";
        art.loading = "lazy";
        setImageSource(art, image.url, true);
        caption.textContent = image.name;
        button.append(art, caption);
        button.onclick = () => {
          try {
            apply(image.url);
            dialog.close();
          } catch (e) {
            onError(e);
          }
        };
        grid.append(button);
      }
      more.hidden = !result.hasMore;
      galleryStatus.textContent = grid.children.length
        ? grid.children.length + " imagem(ns) disponível(is)."
        : "Nenhuma imagem encontrada.";
    } catch (e) {
      if (version !== requestVersion) return;
      galleryStatus.textContent =
        "Não foi possível carregar as imagens. Tente abrir a galeria novamente.";
      onError(e);
    } finally {
      if (version === requestVersion) more.disabled = false;
    }
  }
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const ownGeneration = generation;
    let cardId;
    try {
      cardId = JSON.parse($("card-json").value).numeroCatalogo;
    } catch (e) {
      onError(Error("Corrija o JSON da carta antes de enviar a imagem."));
      input.value = "";
      return;
    }
    input.disabled = true;
    status.textContent = "Convertendo e enviando imagem…";
    try {
      const prepared = await prepare(file, "card"),
        result = await request(
          "/admin/card-images?nome=" +
            encodeURIComponent(file.name.slice(0, 120) || "Imagem de carta"),
          {
            method: "POST",
            headers: { "Content-Type": prepared.blob.type },
            body: prepared.blob,
          },
        );
      if (
        generation !== ownGeneration ||
        JSON.parse($("card-json").value).numeroCatalogo !== cardId
      ) {
        status.textContent =
          "Imagem salva na galeria. Selecione-a para aplicar à carta desejada.";
        return;
      }
      apply(result.image.url);
    } catch (e) {
      if (generation === ownGeneration)
        status.textContent = "A imagem não foi aplicada. Tente novamente.";
      onError(e);
    } finally {
      input.disabled = false;
      input.value = "";
    }
  };
  $("choose-card-image").onclick = () => {
    search.value = "";
    dialog.showModal();
    void load();
  };
  $("close-card-image-gallery").onclick = () => dialog.close();
  more.onclick = () => void load(true);
  search.oninput = () => {
    clearTimeout(timer);
    requestVersion++;
    timer = setTimeout(() => void load(), 250);
  };
  dialog.addEventListener("close", () => {
    requestVersion++;
    clearTimeout(timer);
  });
  return {
    show(card) {
      generation++;
      renderPreview(card.imgURL);
      status.textContent = "";
      input.value = "";
      if (dialog.open) dialog.close();
    },
  };
}
