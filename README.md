# 🃏 ZTCG - Zacornia Trading Card Game
[![MIT License](https://img.shields.io/badge/License-MIT-red.svg)](https://choosealicense.com/licenses/mit/) 

O **ZTCG** é um motor de jogo de cartas digital desenvolvido para aplicar conceitos de lógica de programação, manipulação dinâmica do DOM e arquitetura de software em JavaScript puro. Este projeto é uma extensão técnica do universo de **Zacornia RPG**, um sistema de RPG de mesa autoral que venho desenvolvendo.

---

### 🚀 O que é?
Este projeto é um simulador de batalhas de cartas que permite ao usuário gerenciar decks e executar partidas em um ambiente web. Ele foi criado como um laboratório para testar algoritmos de sorteio, gerenciamento de estados de jogo e interfaces interativas.

### 🛠️ Com o que foi feito?
O projeto foi construído utilizando tecnologias fundamentais da web para garantir performance e total controle sobre o fluxo de dados:
* **JavaScript (ES6+):** Utilizado para toda a lógica de negócio, regras do jogo e manipulação de eventos.
* **HTML5:** Estrutura semântica para os componentes do tabuleiro e das cartas.
* **CSS3:** Estilização modular para criar uma interface imersiva e responsiva.

### ⚙️ Como funciona?
A arquitetura do projeto segue princípios de programação modular:
1. **Gerenciamento de Decks:** O sistema utiliza objetos JavaScript para definir as propriedades de cada carta (ataque, defesa, efeitos) e funções de embaralhamento baseadas em probabilidade.
2. **Ciclo de Vida da Partida:** Implementação de uma máquina de estados que controla as fases de compra de cartas, fase de ação e encerramento de turnos.
3. **Renderização Dinâmica:** Em vez de elementos estáticos, o jogo gera os componentes da interface em tempo real via **Manipulação de DOM**, permitindo atualizações fluidas sem recarregar a página.

### ✨ Funcionalidades
* **Criação de Baralhos:** Sistema que permite a organização de kits de cartas personalizados.
* **Lógica de Combate:** Algoritmos que calculam interações entre atributos das cartas.
* **Interface Interativa:** Feedback visual para interações do jogador com os elementos do tabuleiro.

---

### 📦 Como executar o projeto
1. Clone este repositório:
   ```bash
   git clone [https://github.com/ariel0972/ZTCG.git](https://github.com/ariel0972/ZTCG.git)
