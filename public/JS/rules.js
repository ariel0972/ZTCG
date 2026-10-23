import { api, navbar, node } from "./auth.js";
void navbar();
const container = document.getElementById("rules-reactions");
async function load() {
  try {
    const { reactions, experience } = await api("/rules-data");
    const progression = document.getElementById("experience-rules");
    const titles = node("ul");
    for (const range of experience.titles)
      titles.append(
        node(
          "li",
          `${range.max === null ? `Nível ${range.min} em diante` : range.min === range.max ? `Nível ${range.min}` : `Níveis ${range.min} a ${range.max}`}: ${range.title}`,
        ),
      );
    progression.replaceChildren(
      node(
        "p",
        `Cada partida normal dá ${experience.base} XP: vitória soma ${experience.winBonus} (${experience.base + experience.winBonus} XP), derrota soma ${experience.lossBonus} (${experience.base + experience.lossBonus} XP) e empate dá ${experience.base} XP. Desistência, desconexão ou inatividade dão ${experience.interrupted} XP de base para cada jogador, sujeitos às regras de duração e desistência abaixo.`,
      ),
      node(
        "p",
        `Vitórias ou derrotas seguidas aumentam o XP em ${experience.streakStep * 100}% por resultado igual, a partir do segundo, até ×${experience.maximumMultiplier.toLocaleString("pt-BR")}. O resultado oposto inicia uma nova sequência. Empate, desistência, desconexão e inatividade zeram as sequências dos dois jogadores. O XP de cada partida é arredondado para o inteiro mais próximo.`,
      ),
      node(
        "p",
        "As regras atuais de duração e desistência também se aplicam a todo o histórico, incluindo partidas antigas. O XP é acumulado; subir de nível não gasta seus pontos.",
      ),
      node(
        "p",
        `XP total para os primeiros níveis: ${experience.thresholds
          .slice(1, 8)
          .map(
            ({ level, xp }) => `nível ${level}: ${xp.toLocaleString("pt-BR")}`,
          )
          .join(
            " · ",
          )}. Depois do nível 5, o intervalo de XP cresce em 200 a cada nível (620, 820, 1.020…).`,
      ),
      node("h3", "Duração e desistências"),
      node(
        "p",
        "O XP normal é multiplicado pelo fator de sequência e pelo de duração: até 4 turnos ×1; 5–9 ×1,3; 10–19 ×1,8; 20–29 ×2,2; 30 ou mais ×1,7. O arredondamento acontece uma única vez no final.",
      ),
      node(
        "p",
        "Desistir antes do turno 6 não concede XP e não registra a partida no histórico ou nas estatísticas. A partir da quarta desistência consecutiva de um jogador, ambos recebem XP e contam a partida jogada, mas ela não soma vitória, derrota, ranking ou histórico público. Concluir uma partida sem desistir, incluindo ganhar por desistência do adversário, reinicia essa sequência.",
      ),
      node("h3", "Seu título acompanha o nível"),
      titles,
    );
    container.replaceChildren();
    for (const [name, info] of Object.entries(reactions)) {
      const card = node("div", "", "reaction-rule");
      card.append(
        node("h3", name),
        node("span", info.elements, "muted"),
        node("p", info.description),
      );
      container.append(card);
    }
  } catch (e) {
    const retry = node("button", "Tentar novamente");
    retry.onclick = () => void load();
    container.replaceChildren(node("p", e.message), retry);
    document
      .getElementById("experience-rules")
      .replaceChildren(
        node(
          "p",
          "Não foi possível carregar a progressão. Use Tentar novamente nas reações acima.",
        ),
      );
  }
}
void load();
