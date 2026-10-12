# STCP GO — Porto em Movimento

Aplicação web progressiva (PWA) para telemóveis iPhone/Android e computador, em português de Portugal.

## O que está implementado

- Pesquisa de paragens por nome e código; paragens perto de mim (GPS, com autorização).
- Pesquisa de linhas STCP, sentidos e sequências de paragens.
- Horários **programados**, com base no ficheiro GTFS da STCP, atualizados quando a origem fornece um novo ficheiro.
- Planeador de percursos diretos ou com uma mudança de autocarro.
- Mapa interativo de autocarros com **posições GPS públicas** fornecidas pelo Porto Digital/FIWARE, sujeito à disponibilidade do serviço.
- Favoritos locais.
- Partilha nativa por WhatsApp, Mensagens ou outra aplicação. A mensagem inclui a linha, a paragem e o horário **programado**, e um link direto para consultar novamente. Se a app estiver publicada em HTTPS, o link abre a mesma paragem nesta app. Enquanto a app só estiver em `localhost`, a partilha abre a página **oficial** dessa paragem na STCP.
- Link para acompanhar as chegadas **em tempo real no portal oficial da STCP**.
- Instalável no ecrã principal (PWA com ficheiro manifest e service worker).

**Importante:** Não há qualquer simulação de tempos em tempo real. O feed público GPS indica posições; os horários do GTFS são programados e **não** integram atrasos. Os minutos de chegada em tempo real no portal oficial da STCP não são expostos pela app enquanto não houver integração autorizada/testada. Se a fonte GPS não responder, a app mostra a indisponibilidade.

## Arranque no computador

Necessita de **Python 3.10+**, com acesso à Internet no primeiro arranque. Não é necessário instalar bibliotecas Python.

```bash
cd STCP-GO
python3 server.py
```

Abrir `http://localhost:8765` no navegador.

A importação inicial tenta localizar o GTFS mais recente no catálogo CKAN dos dados abertos da cidade do Porto. Se a plataforma não responder, será mostrado um erro transparente, sem dados falsos.

Podes fornecer um ZIP GTFS diretamente, caso a API do portal mude:

```bash
STCP_GTFS_URL='https://um-servidor-autorizado/ficheiro.zip' python3 server.py
```

O ficheiro só é guardado em `.cache/stcp-gtfs.zip` **depois de ser validado**. A app continua a usar o último GTFS válido se a atualização falhar. Por omissão, faz a atualização no arranque; permite atualização manual na interface.

## Instalar no iPhone e no Android

Para estar acessível fora do computador, precisa de ser **publicada num servidor HTTPS** que execute Python (por exemplo, Render ou Railway) e aponte o domínio para este serviço. Para um teste local no mesmo Wi-Fi podes abrir `http://IP_DO_COMPUTADOR:8765` no telemóvel; algumas funções, como localização e instalação PWA, exigem HTTPS.

- **iPhone:** abrir o endereço HTTPS no Safari → Partilhar → «Adicionar ao ecrã principal».
- **Android:** abrir o endereço HTTPS no Chrome → Menu → «Instalar aplicação» ou «Adicionar ao ecrã principal».

O mesmo URL HTTPS será usado pelos links partilhados para abrir diretamente uma paragem ou autocarro.

Exemplo de link de paragem:

```
https://teu-dominio.pt/?stop=CMP1
```

Exemplo de acompanhamento de uma viatura que esteja no feed GPS:

```
https://teu-dominio.pt/?vehicle=ID_OBTIDO_NO_FEED
```

**Não é uma aplicação oficial da STCP nem está publicada nas lojas Apple/Google.**

## Fontes públicas

- GTFS STCP: https://opendata.porto.digital/dataset/horarios-paragens-e-rotas-em-formato-gtfs-stcp
- GPS STCP: https://dadosabertos.cm-porto.pt/dataset/urban-platform-bus-location
- Chegadas em tempo real (site STCP): https://stcp.pt/pt/paragem
- Informação STCP sobre dados em Google Maps: https://stcp.pt/pt/stcp-chega-em-tempo-real-ao-google-maps

## Privacidade

Não guarda contas nem dados pessoais num servidor. Os favoritos ficam exclusivamente no navegador do utilizador (localStorage). A localização GPS é pedida apenas quando o utilizador carrega «Perto de mim». O endereço e a localização do telemóvel não são partilhados nos links da paragem; os links de autocarro mostram a **posição da viatura do feed público**, não a do utilizador.

## Executar testes de lógica (dados sintéticos, sem rede)

```bash
python3 -m unittest discover -s tests -v
```

## Estrutura

- `server.py`: servidor HTTP/API, leitura de GTFS e proxy de GPS FIWARE.
- `public/index.html`: interface.
- `public/app.js`: pesquisas, partilha, mapa e navegação.
- `public/style.css`: visual responsivo.
- `public/manifest.webmanifest`, `public/sw.js`, `public/icon.svg`: instalação PWA.

## Limitações conhecidas

O catálogo GTFS e a fonte FIWARE são serviços de terceiros e podem mudar o formato ou estar temporariamente indisponíveis. Uma integração direta, **confirmada**, dos tempos de chegada em tempo real na app dependerá do acesso a um endpoint oficial/autorizado e de testes de conectividade. Planeamento de percursos não contempla todos os transbordos, distância pedonal entre paragens distintas, tarifas ou perturbações em tempo real.
