import Avatar from "../db/models/avatar";
import { getCatalog } from "./catalog";
import { storeAvatar } from "./avatars";
export async function storeCardImage(bytes: Buffer, name: string) {
  const url = await storeAvatar(bytes, "card", name);
  // A previously uploaded avatar can have the same bytes; explicitly register it in the card gallery.
  const hash = url.split("/").pop()!.split(".")[0];
  await Avatar.updateOne(
    { _id: hash },
    { $set: { kind: "card", name } },
    { runValidators: true },
  );
  return { url, name };
}
export async function cardImageLibrary(page: number, search: string) {
  const escaped = Array.from(search, (c) =>
    [92, 94, 36, 46, 42, 43, 63, 40, 41, 91, 93, 123, 125, 124].includes(
      c.charCodeAt(0),
    )
      ? String.fromCharCode(92) + c
      : c,
  ).join("");
  const uploads = await Avatar.find({
    kind: "card",
    ...(search ? { name: { $regex: escaped, $options: "i" } } : {}),
  })
    .select("_id name createdAt")
    .sort({ createdAt: -1, _id: -1 })
    .skip(page * 40)
    .limit(41)
    .lean();
  const native =
    page === 0
      ? (await getCatalog())
          .filter(
            (c) =>
              c.imgURL &&
              (c.nome + " " + c.numeroCatalogo)
                .toLocaleLowerCase("pt-BR")
                .includes(search.toLocaleLowerCase("pt-BR")),
          )
          .map((c) => ({
            url: c.imgURL!,
            name: c.numeroCatalogo + " · " + c.nome,
          }))
      : [];
  const images = [
    ...new Map(
      [
        ...uploads.slice(0, 40).map((i) => ({
          url: "/avatars/" + i._id + ".webp",
          name: i.name ?? "Imagem enviada",
        })),
        ...native,
      ].map((i) => [i.url, i]),
    ).values(),
  ];
  return { images, hasMore: uploads.length > 40, page };
}
