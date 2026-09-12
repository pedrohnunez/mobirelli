import React, { useState, useEffect, useLayoutEffect, useCallback, useRef, useId, forwardRef, useImperativeHandle } from "react";
import { createPortal } from "react-dom";
import * as maplibregl from "maplibre-gl";
import mapStyle from "./mapStyle.json";

// o worker do MapLibre importa um chunk interno ("maplibre-gl-shared.mjs") que o
// Vite não empacota quando o arquivo é copiado como asset cru — o worker falhava
// ao carregar e nenhuma rua/rótulo aparecia. Por isso usamos uma cópia pré-empacotada
// (tudo em um arquivo só, sem imports externos) publicada em /public.
maplibregl.setWorkerUrl("/maplibre-gl-worker.js");
import { getKV, setKV, subscribeKV, uploadArquivo } from "./lib/storage";
import { useAuth, signIn, signOut, chamarAdminApi, listarUsuarios } from "./lib/auth";
import {
  Bike,
  Wallet,
  LayoutDashboard,
  Users,
  Plus,
  X,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Wrench,
  Trash2,
  Pencil,
  FileText,
  Search,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Phone,
  Mail,
  MapPin,
  Settings,
  Image as ImageIcon,
  Navigation,
  Crosshair,
  Route,
  RefreshCw,
  ExternalLink,
  Eye,
  EyeOff,
  LogOut,
  Lock,
  ShieldCheck,
  KeyRound,
  Info,
  Landmark,
  Timer,
} from "lucide-react";
import {
  ResponsiveContainer,
  ComposedChart,
  AreaChart,
  Bar,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

/* ===========================================================
   THEME — sistema de design fixo: cinza-grafite neutro, verde da marca
   como único destaque, zero bordas visíveis (superfícies separadas por
   contraste, não por contorno)
=========================================================== */
const theme = {
  bg: "#121212",
  panel: "#1A1A1A",
  card: "#1A1A1A",
  card2: "#242420",
  // sem bordas em card/badge/avatar/ícone — único uso permitido é como divisor
  // fino (borderTop/Bottom) entre linhas de uma lista, nunca como caixa
  cardBorder: "transparent",
  divider: "#242420",
  mint: "#2FA666",
  mintText: "#0E2116",
  sage: "#6FA087",
  amber: "#D9A25A",
  coral: "#D9695E",
  text: "#F5F4EF",
  textMuted: "#A8ABA3",
  textFaint: "#8A8D85",
  textGhost: "#5A5D58",
  outline: "#2A2E29",
  outlineText: "#C7CAC2",
  chartMuted: "#4A4D48",
};

// mesma ideia do "theme" acima — mutado uma vez no topo de AppAutenticado (a partir do
// perfil logado) e lido "ao vivo" por qualquer componente que precise esconder um botão
// de criar/editar/excluir pra quem só pode visualizar
const permissoes = { podeEditar: true, podeGerenciarUsuarios: false };

const clamp255 = (n) => Math.min(255, Math.max(0, n));
const hexToRgb = (hex) => {
  const h = (hex || "#000000").replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16) || 0;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};
const rgbToHex = ({ r, g, b }) =>
  "#" + [r, g, b].map((v) => clamp255(Math.round(v)).toString(16).padStart(2, "0")).join("");
const hexToRgba = (hex, alpha) => {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};
const mixColors = (hexA, hexB, t) => {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  return rgbToHex({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t });
};
// títulos usam Inter Tight peso 700 (geométrica, mais "cheia"); o resto da interface
// usa Inter em só 2 pesos (400 regular e 600 semibold)
const HEAD_FONT = "'Inter Tight', -apple-system, BlinkMacSystemFont, system-ui, sans-serif";
const BODY_FONT = "'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif";
const MONO_FONT = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

const fontImport = `
@import url('https://fonts.googleapis.com/css2?family=Inter+Tight:wght@700&family=Inter:wght@400;600&family=IBM+Plex+Mono:wght@500&display=swap');
`;

/* ===========================================================
   HELPERS
=========================================================== */
const uid = () => Math.random().toString(36).slice(2, 10);

// o Storage do Supabase rejeita chaves com acento (ex: "Joao" com til, "contracao" com
// cedilha) com erro "InvalidKey" — o upload falha silenciosamente. Isso troca só o NOME
// usado no caminho de armazenamento por uma versão sem acento; o nome original mostrado
// pro usuário não muda.
const DIACRITICOS = new RegExp("[" + String.fromCharCode(0x0300) + "-" + String.fromCharCode(0x036f) + "]", "g");
const nomeArquivoSeguro = (nome) => (nome || "arquivo").normalize("NFD").replace(DIACRITICOS, "");

const formatCurrency = (v) =>
  (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const formatCompact = (v) => {
  const n = Number(v) || 0;
  const abs = Math.abs(n);
  if (abs >= 1000) return `R$ ${(n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}mil`;
  return `R$ ${n.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
};

const formatDate = (d) => {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
};

// máscaras — sempre a partir dos dígitos puros, refeitas a cada tecla (não acumulam erro)
const maskCpfCnpj = (v) => {
  const d = (v || "").replace(/\D/g, "").slice(0, 14);
  if (d.length <= 11) {
    return d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  }
  return d
    .replace(/(\d{2})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
};

const maskTelefone = (v) => {
  const d = (v || "").replace(/\D/g, "").slice(0, 11);
  if (d.length <= 10) {
    return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d{1,4})$/, "$1-$2");
  }
  return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d{1,4})$/, "$1-$2");
};

const maskCep = (v) => (v || "").replace(/\D/g, "").slice(0, 8).replace(/(\d{5})(\d{1,3})$/, "$1-$2");

// placa fica guardada sem traço (bate com o nome do dispositivo na Melocaliza e com o texto
// digitado no fluxo de caixa) — o traço é só visual, aplicado sempre na hora de mostrar/digitar
const placaLimpa = (v) => (v || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 7);
const formatPlaca = (v) => {
  const d = placaLimpa(v);
  return d.length <= 3 ? d : `${d.slice(0, 3)}-${d.slice(3)}`;
};

// liga lançamentos de entrada à moto pela placa (categoria/descrição), tipo "Mensalidade URB5I50" —
// é assim que o fluxo de caixa já é lançado, então usamos isso pra saber o que essa moto já recebeu de verdade
function pagamentosDaMoto(moto, lancamentos) {
  const p = (moto?.placa || "").toUpperCase().trim();
  if (!moto) return [];
  return (lancamentos || [])
    .filter(
      (l) =>
        l.tipo === "entrada" &&
        (l.motoId === moto.id || (p && !l.motoId && `${l.categoria || ""} ${l.descricao || ""}`.toUpperCase().includes(p)))
    )
    .sort((a, b) => (a.data < b.data ? 1 : -1));
}

// custos da moto — junta os registros manuais (custosExtras) com as saídas do fluxo
// de caixa que foram vinculadas a essa moto (ex: despachante lançado direto no Caixa).
// Fica de fora dessa lista qualquer lançamento com natureza "Manutenção" — esse tipo
// de gasto entra em manutencoesDaMoto, não aqui, mesmo quando lançado direto no Caixa
function custosDaMoto(moto, lancamentos) {
  if (!moto) return [];
  const manuais = (moto.custosExtras || []).map((c) => ({
    id: c.id,
    data: c.data,
    descricao: c.descricao || "Sem descrição",
    valorGasto: c.valorGasto,
  }));
  const doCaixa = (lancamentos || [])
    .filter((l) => l.tipo === "saida" && l.motoId === moto.id && l.natureza !== "Manutenção")
    .map((l) => ({
      id: l.id,
      data: l.data,
      descricao: l.descricao || l.categoria || "Sem descrição",
      valorGasto: l.valor,
      doCaixa: true,
    }));
  return [...manuais, ...doCaixa].sort((a, b) => (a.data < b.data ? 1 : -1));
}

// manutenções da moto — junta os registros manuais (moto.manutencoes, cadastrados pelo
// botão "Nova manutenção" na própria moto) com as saídas do fluxo de caixa lançadas
// direto no Caixa com natureza "Manutenção" e vinculadas a essa moto. Isso evita que uma
// troca de óleo lançada no Caixa apareça errado em "Custos" — e como o valor já entra
// no lucro do mês pelo caminho normal do Caixa (toda saída que não é "Expansão" reduz o
// lucro), NÃO soma aqui de novo em nenhum cálculo de lucro/prejuízo, só na exibição
function manutencoesDaMoto(moto, lancamentos) {
  if (!moto) return [];
  const manuais = (moto.manutencoes || []).map((m) => ({
    id: m.id,
    data: m.data,
    descricao: m.tipo || "Manutenção",
    valorGasto: m.valorGasto,
  }));
  const doCaixa = (lancamentos || [])
    .filter((l) => l.tipo === "saida" && l.motoId === moto.id && l.natureza === "Manutenção")
    .map((l) => ({
      id: l.id,
      data: l.data,
      descricao: l.descricao || l.categoria || "Manutenção",
      valorGasto: l.valor,
    }));
  return [...manuais, ...doCaixa].sort((a, b) => (a.data < b.data ? 1 : -1));
}

// projeta os próximos `meses` meses (a partir do mês atual) somando as contas futuras —
// as recorrentes (ex: contabilidade, aluguel de uma moto fixo) contam em todo mês a partir
// do vencimento cadastrado, as avulsas (ex: imposto de renda) só contam no mês do próprio
// vencimento. Entradas e saídas são somadas separadamente pra dar o saldo previsto do mês.
function projecaoFuturosPorMes(futuros, meses = 12) {
  const hoje = new Date();
  const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const resultado = [];
  for (let i = 0; i < meses; i++) {
    const d = new Date(inicio.getFullYear(), inicio.getMonth() + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    let entrada = 0;
    let saida = 0;
    (futuros || []).forEach((f) => {
      if (!f.vencimento) return;
      const vd = new Date(`${f.vencimento}T00:00:00`);
      const valor = Number(f.valor) || 0;
      const conta = f.tipo === "entrada" ? (v) => (entrada += v) : (v) => (saida += v);
      if (f.recorrente) {
        const inicioRecorrencia = new Date(vd.getFullYear(), vd.getMonth(), 1);
        const fimRecorrencia = f.dataTermino ? new Date(`${f.dataTermino}T00:00:00`) : null;
        if (d >= inicioRecorrencia && (!fimRecorrencia || d <= fimRecorrencia)) conta(valor);
      } else if (!f.pago && f.vencimento.slice(0, 7) === key) {
        conta(valor);
      }
    });
    resultado.push({ key, mes: monthLabel(key), entrada, saida, saldo: entrada - saida });
  }
  return resultado;
}

// representa os contratos de aluguel ativos como se fossem "futuros" recorrentes —
// assim a mensalidade de cada moto alugada entra automaticamente na previsão de
// Futuros, sem precisar cadastrar de novo. Usa a data de término do contrato (se
// tiver sido preenchida) como limite; sem data, entra como indefinido.
// PRIMEIRA COBRANÇA de um contrato.
//
// O aluguel é pago no fim do período, não na entrada: quem alugou dia 4 deste mês só
// paga dia 4 do mês QUE VEM. Então um contrato que começou neste mês ainda não gera
// cobrança agora — e era isso que fazia o previsto do mês crescer sozinho assim que
// uma moto nova era alugada, obrigando a ir olhar contrato por contrato pra saber o que
// dava pra cobrar de verdade.
//
// Devolve a data (YYYY-MM-DD) da primeira cobrança: o dia de vencimento do contrato,
// no mês seguinte ao do início. Sem data de início, não dá pra afirmar nada — devolve
// null e o contrato segue valendo desde sempre, como era antes.
function primeiraCobrancaDoContrato(contrato) {
  const inicio = contrato?.dataInicio;
  if (!inicio) return null;
  const [ano, mes] = inicio.split("-").map(Number);
  if (!ano || !mes) return null;
  const dia = diaVencimentoDoContrato(contrato) || Number(inicio.slice(8, 10)) || 1;
  // mês seguinte ao do início; o dia é limitado ao último dia desse mês (dia 31 em
  // mês de 30, ou 29/30/31 em fevereiro, cairia no mês seguinte sem esse cuidado)
  const alvo = new Date(ano, mes, 1);
  const ultimoDia = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate();
  const diaOk = Math.min(dia, ultimoDia);
  return `${alvo.getFullYear()}-${String(alvo.getMonth() + 1).padStart(2, "0")}-${String(diaOk).padStart(2, "0")}`;
}

// o contrato já pode ser cobrado no mês "mesKey"? (mesKey no formato YYYY-MM)
function contratoCobraNoMes(contrato, mesKey) {
  const primeira = primeiraCobrancaDoContrato(contrato);
  if (!primeira) return true;
  if (mesKey < primeira.slice(0, 7)) return false;
  const fim = contrato?.dataTermino;
  return !fim || mesKey <= fim.slice(0, 7);
}

function contratosComoFuturos(motos) {
  return (motos || [])
    .filter((m) => m.contratoAtual && Number(m.contratoAtual.valorMensal) > 0)
    .map((m) => ({
      id: `contrato-${m.contratoAtual.id}`,
      tipo: "entrada",
      descricao: `Mensalidade ${formatPlaca(m.placa)}`,
      categoria: "Contrato ativo",
      valor: Number(m.contratoAtual.valorMensal) || 0,
      vencimento: primeiraCobrancaDoContrato(m.contratoAtual) || m.contratoAtual.dataInicio || todayISO(),
      diaVencimento: diaVencimentoDoContrato(m.contratoAtual),
      dataInicioContrato: m.contratoAtual.dataInicio || "",
      dataTermino: m.contratoAtual.dataTermino || "",
      recorrente: true,
      pago: false,
      motoId: m.id,
      origemContrato: true,
    }));
}

function totaisFuturos(futuros, motos) {
  const todos = [...(futuros || []), ...contratosComoFuturos(motos)];
  const recorrentes = todos.filter((f) => f.recorrente);
  const fixoMensalSaida = recorrentes.filter((f) => f.tipo !== "entrada").reduce((s, f) => s + (Number(f.valor) || 0), 0);
  const fixoMensalEntrada = recorrentes.filter((f) => f.tipo === "entrada").reduce((s, f) => s + (Number(f.valor) || 0), 0);
  const avulsosPendentes = todos.filter((f) => !f.recorrente && !f.pago);
  const avulsosPendentesSaida = avulsosPendentes.filter((f) => f.tipo !== "entrada").reduce((s, f) => s + (Number(f.valor) || 0), 0);
  const avulsosPendentesEntrada = avulsosPendentes.filter((f) => f.tipo === "entrada").reduce((s, f) => s + (Number(f.valor) || 0), 0);
  const projecao = projecaoFuturosPorMes(todos, 12);
  const previstoSaida12Meses = projecao.reduce((s, m) => s + m.saida, 0);
  const previstoEntrada12Meses = projecao.reduce((s, m) => s + m.entrada, 0);
  return {
    fixoMensalSaida,
    fixoMensalEntrada,
    avulsosPendentesSaida,
    avulsosPendentesEntrada,
    previstoSaida12Meses,
    previstoEntrada12Meses,
    saldoPrevisto12Meses: previstoEntrada12Meses - previstoSaida12Meses,
  };
}

// O NOME de uma conta futura — o texto que aparece na lista e que vira o título do
// lançamento quando ela é confirmada.
//
// Existem dois formatos de conta futura guardados no banco:
//  - as NOVAS gravam o nome em "nome", e "categoria"/"descricao" são classificação e
//    detalhe extra (a mesma convenção da aba Lançado);
//  - as ANTIGAS não tinham campo "nome": o nome era digitado em "descricao" e a
//    classificação ia em "categoria".
// Por isso "descricao" vem ANTES de "categoria" aqui: numa conta antiga, ler a
// categoria primeiro faria a classificação ("Seguro", "Ferramenta") aparecer no lugar
// do nome que a pessoa digitou — que era exatamente o que acontecia antes.
function nomeDoFuturo(f) {
  return f?.nome || f?.descricao || f?.categoria || "Sem nome";
}

// detalhe extra de uma conta futura, sem repetir o que já está no nome (numa conta
// antiga "descricao" É o nome, então ali não sobra detalhe nenhum)
function detalheDoFuturo(f) {
  return f?.nome ? f?.descricao || "" : "";
}

// quanto está previsto entrar/sair nos próximos `dias` dias — pra ver rapidinho o que
// vence essa semana, sem precisar abrir o mês inteiro em "Futuros". Também devolve item
// a item (moto/categoria) pra dar pra mostrar "de onde vem" ao passar o mouse
function futurosProximosDias(futuros, motos, dias = 7) {
  const todos = [...(futuros || []), ...contratosComoFuturos(motos)];
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const limite = new Date(hoje);
  limite.setDate(limite.getDate() + dias);
  let entrada = 0;
  let saida = 0;
  const itensEntrada = new Map();
  const itensSaida = new Map();

  const rotulo = (f) => {
    const moto = motos?.find((m) => m.id === f.motoId);
    const base = nomeDoFuturo(f);
    if (!moto) return base;
    const placa = formatPlaca(moto.placa);
    return base.includes(placa) ? base : `${base} (${placa})`;
  };

  todos.forEach((f) => {
    if (!f.vencimento) return;
    const valor = Number(f.valor) || 0;
    const itens = f.tipo === "entrada" ? itensEntrada : itensSaida;
    const soma = (v) => {
      if (f.tipo === "entrada") entrada += v;
      else saida += v;
      const label = rotulo(f);
      itens.set(label, (itens.get(label) || 0) + v);
    };
    if (f.recorrente) {
      const diaVenc = f.diaVencimento ? Number(f.diaVencimento) : new Date(`${f.vencimento}T00:00:00`).getDate();
      const fimRecorrencia = f.dataTermino ? new Date(`${f.dataTermino}T00:00:00`) : null;
      // olha esse mês e o próximo, pra cobrir vencimento que cai virando o mês
      for (let i = 0; i < 2; i++) {
        const candidato = new Date(hoje.getFullYear(), hoje.getMonth() + i, diaVenc);
        const candidatoKey = `${candidato.getFullYear()}-${String(candidato.getMonth() + 1).padStart(2, "0")}`;
        // se esse mês já foi confirmado (virou lançamento real em "Lançado"), não conta
        // de novo aqui — senão o valor continuava aparecendo como "a pagar" mesmo depois
        // de já ter sido pago
        if (candidato >= hoje && candidato <= limite && (!fimRecorrencia || candidato <= fimRecorrencia) && !(f.confirmados || []).includes(candidatoKey)) {
          soma(valor);
          break;
        }
      }
    } else if (!f.pago) {
      const vd = new Date(`${f.vencimento}T00:00:00`);
      if (vd >= hoje && vd <= limite) soma(valor);
    }
  });

  const paraLista = (mapa) => [...mapa.entries()].map(([label, total]) => ({ label, total })).sort((a, b) => b.total - a.total);
  return { entrada, saida, itensEntrada: paraLista(itensEntrada), itensSaida: paraLista(itensSaida) };
}

// uma conta futura (avulsa ou fixa mensal) "pendura" num mês de "Lançado" enquanto ainda
// não foi confirmada — pra avulsa é só olhar o próprio vencimento; pra fixa mensal, ela
// pendura em TODOS os meses dentro do período de vigência que ainda não têm essa mesma
// conta confirmada (marcada em f.confirmados, uma lista de "AAAA-MM" já virados lançamento)
const futuroPendenteNoMes = (f, mesKey) => {
  if (f.recorrente) {
    const inicioKey = (f.vencimento || todayISO()).slice(0, 7);
    const fimKey = f.dataTermino ? f.dataTermino.slice(0, 7) : null;
    if (mesKey < inicioKey) return false;
    if (fimKey && mesKey > fimKey) return false;
    return !(f.confirmados || []).includes(mesKey);
  }
  if (f.pago) return false;
  return f.vencimento?.slice(0, 7) === mesKey;
};

// data usada pra ordenar/gerar o lançamento quando a conta é confirmada num mês — pra
// fixa mensal, usa o dia de vencimento configurado dentro do mês em questão (não o mês
// em que ela foi cadastrada originalmente)
const dataDoFuturoNoMes = (f, mesKey) => {
  if (!f.recorrente) return f.vencimento || `${mesKey}-01`;
  const dia = f.diaVencimento || Number((f.vencimento || `${mesKey}-01`).slice(8, 10)) || 1;
  return `${mesKey}-${String(dia).padStart(2, "0")}`;
};

// consulta o CEP no ViaCEP (serviço público, gratuito, sem chave) e devolve o endereço
// pra preencher os campos sozinho — só chama quando o CEP tem os 8 dígitos
async function buscarEnderecoPorCEP(cep) {
  const digits = (cep || "").replace(/\D/g, "");
  if (digits.length !== 8) return null;
  try {
    const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
    const data = await res.json();
    if (!res.ok || data.erro) return null;
    return {
      logradouro: data.logradouro || "",
      bairro: data.bairro || "",
      cidade: data.localidade || "",
      estado: data.uf || "",
    };
  } catch {
    return null;
  }
}

const isOverdue = (dateStr) => {
  if (!dateStr) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(dateStr + "T00:00:00") < today;
};

// dia do mês em que o cliente paga a mensalidade — contratos antigos guardavam uma
// data completa (dataVencimento), então aproveita o dia dela se o campo novo (diaVencimento)
// ainda não tiver sido preenchido
function diaVencimentoDoContrato(contrato) {
  if (!contrato) return null;
  if (contrato.diaVencimento) return Number(contrato.diaVencimento);
  if (contrato.dataVencimento) return Number(contrato.dataVencimento.slice(8, 10));
  return null;
}

// QUITOU o mês? Um pagamento lançado em qualquer dia do mês já quita a mensalidade
// daquele mês. O dono lança a entrada no mês em que recebe o dinheiro, então é o mês do
// lançamento que importa, não o dia: comparar com o dia do vencimento fazia o pagamento
// recebido ANTES do dia (recebeu dia 5, vencimento dia 10) continuar contando como
// atrasado — era isso que deixava a moto marcada em vermelho com o pagamento já lançado.
// Lançamento de mês posterior também conta (pagou atrasado, mas pagou).
const pagouNoMes = (pagamentos, mesKey) => (pagamentos || []).some((p) => (p.data || "").slice(0, 7) >= mesKey);

// vencido = o mês já é cobrável, o dia de pagamento dele já passou e não existe nenhuma
// entrada lançada no Caixa pra essa moto nesse mês
const isContratoVencido = (contrato, pagamentos) => {
  const dia = diaVencimentoDoContrato(contrato);
  if (!dia) return false;
  const hoje = new Date();
  const hojeZero = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
  // a primeira cobrança só vence um mês depois do início do contrato (aluguel é pago no
  // fim do período) — e contrato já encerrado não vence mais nada
  if (!contratoCobraNoMes(contrato, mesAtual)) return false;
  const vencimentoDoMes = new Date(hoje.getFullYear(), hoje.getMonth(), dia);
  if (hojeZero <= vencimentoDoMes) return false;
  return !pagouNoMes(pagamentos, mesAtual);
};

const monthLabel = (key) => {
  const [y, m] = key.split("-");
  const names = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  return `${names[Number(m) - 1]}/${y.slice(2)}`;
};

const todayISO = () => new Date().toISOString().slice(0, 10);

// quando alguém "adiciona à tela inicial", o app abre sem barra de navegador e sem botão
// de recarregar — se o celular ficou algum tempo sem reabrir o app enquanto uma versão
// nova foi publicada, ele pode continuar rodando o código antigo guardado em cache sem
// nenhum jeito óbvio de atualizar sozinho (parece "travado": os botões não fazem nada
// porque o JS antigo não bate mais com o resto). Esse hook confere de vez em quando (e
// sempre que o app volta a ficar visível) se o servidor já tem um arquivo .js diferente
// do que está rodando agora — se tiver, avisa a pessoa pra atualizar
function useVersaoNova() {
  const [disponivel, setDisponivel] = useState(false);
  useEffect(() => {
    const scriptAtual = document.querySelector('script[type="module"][src*="/assets/"]')?.getAttribute("src");
    if (!scriptAtual) return;
    let cancelado = false;
    const conferir = async () => {
      try {
        const resp = await fetch("/", { cache: "no-store" });
        const html = await resp.text();
        const [, scriptNovo] = html.match(/src="(\/assets\/index-[\w-]+\.js)"/) || [];
        if (!cancelado && scriptNovo && scriptNovo !== scriptAtual) setDisponivel(true);
      } catch {
        // sem internet ou instabilidade — não é motivo pra avisar de versão nova
      }
    };
    conferir();
    const aoFicarVisivel = () => {
      if (document.visibilityState === "visible") conferir();
    };
    document.addEventListener("visibilitychange", aoFicarVisivel);
    window.addEventListener("focus", conferir);
    const intervalo = setInterval(conferir, 5 * 60 * 1000);
    return () => {
      cancelado = true;
      document.removeEventListener("visibilitychange", aoFicarVisivel);
      window.removeEventListener("focus", conferir);
      clearInterval(intervalo);
    };
  }, []);
  return disponivel;
}

const enderecoCompleto = (c) => {
  let logradouroNumero = c.logradouro && c.numero ? `${c.logradouro}, ${c.numero}` : c.logradouro;
  if (logradouroNumero && c.complemento) logradouroNumero += ` - ${c.complemento}`;
  return (
    [logradouroNumero, c.bairro, c.cidade && c.estado ? `${c.cidade}/${c.estado}` : c.cidade].filter(Boolean).join(" — ") ||
    "Endereço não informado"
  );
};

/* ===========================================================
   STORAGE — dados compartilhados (você + seu pai, mesmo link)
=========================================================== */
function useSharedList(key) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const val = await getKV(key);
        if (!cancelled) setItems(val || []);
      } catch {
        if (!cancelled) setError("Não foi possível carregar os dados agora.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    // atualiza sozinho quando outra pessoa (ex. seu pai) mexe nos dados em outro aparelho
    const unsubscribe = subscribeKV(key, (val) => setItems(val || []));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [key]);

  const persist = useCallback(
    async (next) => {
      setItems(next);
      try {
        const ok = await setKV(key, next);
        setError(ok ? null : "Não foi possível salvar agora. Tente novamente.");
        return ok;
      } catch {
        setError("Não foi possível salvar agora. Tente novamente.");
        return false;
      }
    },
    [key]
  );

  return { items, persist, loading, error };
}

function useSharedObject(key, defaultValue) {
  const [value, setValue] = useState(defaultValue);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const val = await getKV(key);
        if (!cancelled) setValue(val || defaultValue);
      } catch {
        if (!cancelled) setError("Não foi possível carregar os dados agora.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    const unsubscribe = subscribeKV(key, (val) => setValue(val || defaultValue));
    return () => {
      cancelled = true;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const persist = useCallback(
    async (next) => {
      setValue(next);
      try {
        const ok = await setKV(key, next);
        setError(ok ? null : "Não foi possível salvar agora. Tente novamente.");
        return ok;
      } catch {
        setError("Não foi possível salvar agora. Tente novamente.");
        return false;
      }
    },
    [key]
  );

  return { value, persist, loading, error };
}

/* ===========================================================
   UI ATOMS
=========================================================== */
function Wordmark({ compact, logoDataUrl, logoSize }) {
  const [erro, setErro] = useState(false);
  const src = logoDataUrl || "/logo-header.png";
  if (!erro) {
    const height = logoSize || (compact ? 28 : 38);
    return (
      <img
        src={src}
        alt="Mobirelli"
        style={{ height, width: "auto", maxWidth: "60vw", objectFit: "contain", display: "block" }}
        onError={() => setErro(true)}
      />
    );
  }
  return <WordmarkFallback compact={compact} />;
}

function WordmarkFallback({ compact }) {
  return (
    <div style={{ display: "inline-flex", flexDirection: "column", gap: 3 }}>
      <div className="flex items-center gap-1.5">
        <span style={{ fontFamily: HEAD_FONT, fontWeight: 500, fontSize: compact ? 20 : 26, color: theme.mint }}>mobi</span>
        <span
          style={{
            fontFamily: HEAD_FONT,
            fontWeight: 700,
            fontSize: compact ? 20 : 26,
            color: theme.mintText,
            background: theme.mint,
            borderRadius: 8,
            padding: "1px 10px",
          }}
        >
          relli
        </span>
      </div>
      {!compact && (
        <div className="flex items-center gap-1.5 ml-1">
          <div style={{ width: 12, height: 9, borderLeft: `2px solid ${theme.sage}`, borderBottom: `2px solid ${theme.sage}`, borderBottomLeftRadius: 5 }} />
          <span
            style={{
              fontFamily: BODY_FONT,
              fontSize: 12,
              fontWeight: 700,
              color: theme.mintText,
              background: theme.mint,
              borderRadius: 6,
              padding: "1px 7px",
              letterSpacing: 0.2,
            }}
          >
            aluguel de motos
          </span>
        </div>
      )}
    </div>
  );
}

function MotoPlate({ placa, size = "normal" }) {
  const grande = size === "grande";
  return (
    <div
      style={{
        background: theme.card2,
        borderRadius: grande ? 9 : 6,
        padding: grande ? "6px 14px" : "3px 9px",
        display: "inline-flex",
        alignItems: "center",
      }}
    >
      <span
        style={{
          fontFamily: MONO_FONT,
          fontWeight: 500,
          letterSpacing: grande ? 2 : 1.5,
          fontSize: grande ? 22 : 14,
          color: theme.text,
        }}
      >
        {placa ? formatPlaca(placa) : "SEM PLACA"}
      </span>
    </div>
  );
}

const MOTO_STATUS = {
  disponivel: { label: "Disponível", color: theme.mint, dark: true, icon: CheckCircle2 },
  alugada: { label: "Alugada", color: theme.amber, dark: true, icon: Bike },
  preparacao: { label: "Em preparação", color: theme.sage, dark: true, icon: Clock },
  manutencao: { label: "Em manutenção", color: theme.coral, dark: true, icon: Wrench },
};

function StatusBadge({ status }) {
  const cfg = MOTO_STATUS[status] || MOTO_STATUS.disponivel;
  return <Badge color={cfg.color} icon={cfg.icon} label={cfg.label} />;
}

function Badge({ color, icon: Icon, label }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
      // lineHeight explícito + ícone com display:block — sem isso, o <svg> do ícone
      // segue a métrica de linha do texto ao redor (herdada, varia de navegador pra
      // navegador), e o fundo do badge podia ficar puxado pra cima/baixo em relação
      // ao próprio texto dele mesmo, mesmo com "items-center" no flex
      style={{ background: `${color}26`, color, lineHeight: 1 }}
    >
      <Icon size={11} style={{ display: "block", flexShrink: 0 }} />
      <span>{label}</span>
    </span>
  );
}


// substitui a técnica de grid-template-rows (0fr/1fr) — o Safari do iPhone não colapsa
// esse truque de forma confiável, deixando o conteúdo "fechado" vazar por fora do card.
// Aqui medimos a altura real do conteúdo (scrollHeight) e animamos max-height em pixels,
// que funciona igual em qualquer navegador.
function Collapse({ open, children }) {
  const innerRef = useRef(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const el = innerRef.current;
    if (!open || !el) {
      setHeight(0);
      return;
    }
    setHeight(el.scrollHeight);
    // reajusta se o conteúdo mudar de altura depois de aberto (ex: a fonte do Google
    // Fonts ainda carregando na 1ª vez) — sem isso, a medida antiga ficava pequena
    // demais e cortava o final da lista sem dar pra perceber que faltava conteúdo
    const observer = new ResizeObserver(() => setHeight(el.scrollHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, [open, children]);

  return (
    <div style={{ maxHeight: height, overflow: "hidden", transition: "max-height 0.28s ease" }}>
      <div ref={innerRef}>{children}</div>
    </div>
  );
}

function Modal({ title, onClose, children }) {
  const [show, setShow] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setShow(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const handleClose = () => {
    setClosing(true);
    setTimeout(onClose, 180);
  };

  const visible = show && !closing;

  return createPortal(
    <div
      className="fixed inset-0 flex items-end sm:items-center justify-center"
      style={{ background: "rgba(10,20,13,0.7)", opacity: visible ? 1 : 0, transition: "opacity 0.2s ease", zIndex: 999 }}
      onClick={handleClose}
    >
      <div
        className="w-full sm:max-w-md rounded-t-[24px] sm:rounded-[20px] p-5 max-h-[92vh] overflow-y-auto"
        style={{
          background: theme.panel,
          border: `1px solid ${theme.cardBorder}`,
          boxShadow: "0 -8px 30px rgba(0,0,0,0.25)",
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0) scale(1)" : "translateY(28px) scale(0.97)",
          transition: "transform 0.24s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.2s ease",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sm:hidden mx-auto mb-3 rounded-full" style={{ width: 36, height: 5, background: theme.cardBorder }} />
        <div className="flex items-center justify-between mb-4">
          <h3 style={{ fontFamily: HEAD_FONT, fontSize: 20, color: theme.text }}>{title}</h3>
          <button onClick={handleClose} className="mbr-hover-grow" style={{ color: theme.textMuted }}>
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}

// visualizador de PDF embutido na própria página — usa o leitor nativo do navegador
// dentro de um iframe (já vem com zoom, navegação de páginas, etc.), só com a
// nossa moldura verde em volta pra parecer parte do site
function PdfViewer({ url, title, onClose }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setShow(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center p-2 sm:p-6"
      style={{ background: "rgba(10,20,13,0.85)", opacity: show ? 1 : 0, transition: "opacity 0.2s ease", zIndex: 999 }}
      onClick={onClose}
    >
      <div
        className="w-full h-full sm:w-[92vw] sm:h-[90vh] sm:max-w-4xl rounded-2xl overflow-hidden flex flex-col"
        style={{
          background: theme.panel,
          boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
          opacity: show ? 1 : 0,
          transform: show ? "scale(1)" : "scale(0.97)",
          transition: "opacity 0.2s ease, transform 0.2s ease",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-4 py-3 gap-3"
          style={{ borderBottom: `1px solid ${theme.divider}`, background: theme.card }}
        >
          <span style={{ fontFamily: HEAD_FONT, fontSize: 15, color: theme.text }} className="truncate">
            {title}
          </span>
          <div className="flex items-center gap-3 flex-shrink-0">
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs font-semibold mbr-hover-grow"
              style={{ color: theme.mint }}
            >
              <ExternalLink size={13} /> Nova aba
            </a>
            <button onClick={onClose} className="mbr-hover-grow" style={{ color: theme.textMuted }}>
              <X size={20} />
            </button>
          </div>
        </div>
        <iframe src={url} title={title} style={{ flex: 1, border: "none", background: "#fff" }} />
      </div>
    </div>,
    document.body
  );
}

function FieldLabel({ children }) {
  return (
    <label className="text-xs uppercase tracking-wide mb-1 block" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
      {children}
    </label>
  );
}

const inputStyle = {
  width: "100%",
  background: theme.bg,
  border: `1px solid ${theme.cardBorder}`,
  borderRadius: 10,
  padding: "9px 11px",
  color: theme.text,
  fontFamily: BODY_FONT,
  fontSize: 14,
  marginBottom: 12,
};

// input[type=date] tem um controle nativo (o ícone do calendário) que o navegador
// desenha com um "box" próprio, maior que o de um input de texto comum, mesmo com o
// padding igual — height explícito força os dois a ficarem do mesmo tamanho
const dateInputStyle = { ...inputStyle, height: 41 };

function SelectField({ value, onChange, options }) {
  return (
    <select style={{ ...inputStyle, appearance: "auto" }} value={value} onChange={onChange}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function Row2({ children }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{children}</div>;
}

/* ===========================================================
   ANEXO — link OU upload direto (até 3MB), guardado em chave própria
=========================================================== */
function AnexoField({ label, linkValue, storageKey, fileName, onChange }) {
  const [status, setStatus] = useState("");
  const inputRef = useRef(null);

  const handleFile = (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      setStatus("Arquivo acima de 20MB — use o link do Drive acima para arquivos maiores.");
      return;
    }
    setStatus("Enviando...");
    (async () => {
      const path = `${storageKey}-${nomeArquivoSeguro(file.name)}`;
      const url = await uploadArquivo(path, file);
      if (url) {
        onChange({ link: url, fileName: file.name });
        setStatus("");
      } else {
        setStatus("Não foi possível enviar o arquivo agora.");
      }
    })();
  };

  const handleRemove = () => {
    onChange({ link: "", fileName: "" });
    setStatus("");
  };

  return (
    <div className="mb-3">
      <FieldLabel>{label}</FieldLabel>
      <input
        style={inputStyle}
        value={linkValue}
        onChange={(e) => onChange({ link: e.target.value, fileName })}
        placeholder="Cole o link (Drive, etc.)"
      />
      <div className="flex items-center gap-2 flex-wrap -mt-1">
        <input ref={inputRef} type="file" onChange={handleFile} style={{ display: "none" }} />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="text-xs font-semibold rounded-xl px-3 py-1.5"
          style={{ border: `1px solid ${theme.outline}`, color: theme.outlineText }}
        >
          Anexar arquivo
        </button>
        {fileName && linkValue && (
          <>
            <a
              href={linkValue}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-semibold rounded-xl px-3 py-1.5 flex items-center gap-1"
              style={{ background: theme.mint, color: theme.text, fontWeight: 600 }}
            >
              <FileText size={12} /> {fileName}
            </a>
            <button type="button" onClick={handleRemove} className="mbr-hover-grow" style={{ color: theme.coral }}>
              <Trash2 size={14} />
            </button>
          </>
        )}
      </div>
      {status && (
        <div className="text-xs mt-1.5" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
          {status}
        </div>
      )}
    </div>
  );
}

// campos antigos guardavam só 1 arquivo (ex: contratoLink/contratoArquivo) — os novos
// guardam uma lista. Isso lê os dois formatos pra não perder nada já salvo.
function anexosDe(lista, linkAntigo, nomeAntigo) {
  if (Array.isArray(lista)) return lista;
  if (linkAntigo) return [{ link: linkAntigo, fileName: nomeAntigo || "Anexo" }];
  return [];
}
const contratoAnexosOf = (contrato) => anexosDe(contrato?.anexos, contrato?.contratoLink, contrato?.contratoArquivo);
const notaFiscalAnexosOf = (moto) => anexosDe(moto?.notaFiscalAnexos, moto?.notaFiscalLink, moto?.notaFiscalArquivo);
const notaFiscalFabricaAnexosOf = (moto) => anexosDe(moto?.notaFiscalFabricaAnexos, null, null);

// botão único "Contrato" — se tiver só 1 anexo, abre direto; se tiver mais (várias
// páginas/fotos do mesmo contrato), abre uma listinha pra escolher qual página ver
function ContratoAnexosButton({ anexos, label = "Contrato", tituloPreview, onAbrir }) {
  const [aberto, setAberto] = useState(false);
  if (!anexos || anexos.length === 0) return null;

  if (anexos.length === 1) {
    return (
      <button
        onClick={() => onAbrir(anexos[0].link, tituloPreview)}
        className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-xl px-3 mbr-hover-grow"
        style={{ background: theme.card2, color: theme.mint, minHeight: 44 }}
      >
        <FileText size={13} /> {label}
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setAberto((v) => !v)}
        className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-xl px-3 mbr-hover-grow"
        style={{ background: theme.card2, color: theme.mint, minHeight: 44 }}
      >
        <FileText size={13} /> {label} ({anexos.length})
      </button>
      {aberto && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setAberto(false)} />
          <div
            className="absolute z-20 mt-1 left-0 rounded-xl overflow-hidden flex flex-col mbr-fade-in"
            style={{ background: theme.panel, border: `1px solid ${theme.cardBorder}`, minWidth: 150, boxShadow: "0 6px 20px rgba(0,0,0,0.4)" }}
          >
            {anexos.map((a, i) => (
              <button
                key={i}
                onClick={() => {
                  onAbrir(a.link, `${tituloPreview} (${i + 1}/${anexos.length})`);
                  setAberto(false);
                }}
                className="flex items-center gap-2 px-3 py-2 text-xs text-left mbr-hover-grow"
                style={{ color: theme.text, borderBottom: i < anexos.length - 1 ? `1px solid ${theme.divider}` : "none" }}
              >
                <FileText size={12} /> Página {i + 1}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// mostra de onde vem um valor passando o mouse por cima (computador) ou tocando nele
// (celular, já que touch não tem hover de verdade) — usado só nos "Próximos 7 dias".
// O popover vai num portal pro <body> e usa position:fixed calculado a partir do
// elemento-gatilho: se ficasse "position:absolute" dentro do card normal, o Reveal (que
// anima com transform) cria um novo contexto de empilhamento e o card seguinte da página
// acaba pintando por cima do popover, cortando ele — o portal escapa desse problema.
function ValorComDetalhe({ children, itens, fmt }) {
  const [aberto, setAberto] = useState(false);
  const [pos, setPos] = useState(null);
  const gatilhoRef = useRef(null);

  const abrir = () => {
    const r = gatilhoRef.current?.getBoundingClientRect();
    if (!r) return;
    // reserva a largura MÁXIMA que o popup pode assumir (não a mínima) pra calcular
    // o clamp — senão, com conteúdo largo o bastante pra bater no maxWidth real, ele
    // ainda vaza pela borda direita mesmo com o clamp "aplicado"
    const largura = Math.min(320, window.innerWidth - 16);
    setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - largura - 8)), largura });
    setAberto(true);
  };
  const fechar = () => setAberto(false);

  useEffect(() => {
    if (!aberto) return;
    const onScroll = () => fechar();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [aberto]);

  if (!itens || itens.length === 0) return children;
  return (
    <span
      ref={gatilhoRef}
      className="relative inline-block"
      onMouseEnter={abrir}
      onMouseLeave={fechar}
      onClick={(e) => {
        e.stopPropagation();
        aberto ? fechar() : abrir();
      }}
      style={{ cursor: "help" }}
    >
      {children}
      {aberto &&
        pos &&
        createPortal(
          <>
            <div className="fixed inset-0" style={{ zIndex: 998 }} onClick={fechar} />
            <div
              className="fixed rounded-xl overflow-hidden mbr-fade-in"
              style={{
                top: pos.top,
                left: pos.left,
                zIndex: 999,
                background: theme.panel,
                border: `1px solid ${theme.cardBorder}`,
                width: pos.largura,
                boxShadow: "0 6px 20px rgba(0,0,0,0.4)",
                padding: 10,
              }}
            >
              {itens.map((it, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-3 text-xs py-1"
                  style={{ color: theme.text, fontFamily: BODY_FONT, borderBottom: i < itens.length - 1 ? `1px solid ${theme.divider}` : "none" }}
                >
                  <span className="truncate">{it.label}</span>
                  <span style={{ fontWeight: 700, flexShrink: 0 }}>{fmt(it.total)}</span>
                </div>
              ))}
            </div>
          </>,
          document.body
        )}
    </span>
  );
}

// igual ao AnexoField, mas permite anexar vários arquivos (ou vários links) no mesmo campo —
// útil pro contrato que às vezes vem em várias páginas/fotos separadas
function AnexoMultiField({ label, anexos, storageKey, onChange }) {
  const [status, setStatus] = useState("");
  const [linkInput, setLinkInput] = useState("");
  const inputRef = useRef(null);
  const lista = anexos || [];

  const handleFiles = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length === 0) return;
    const validos = files.filter((f) => f.size <= 20 * 1024 * 1024);
    const grandesDemais = files.length - validos.length;
    if (validos.length === 0) {
      setStatus("Arquivo(s) acima de 20MB — use o link do Drive acima para arquivos maiores.");
      return;
    }
    setStatus(`Enviando ${validos.length > 1 ? `${validos.length} arquivos` : "arquivo"}...`);
    (async () => {
      const enviados = [];
      for (const file of validos) {
        const path = `${storageKey}-${Date.now()}-${nomeArquivoSeguro(file.name)}`;
        const url = await uploadArquivo(path, file);
        if (url) enviados.push({ link: url, fileName: file.name });
      }
      onChange([...lista, ...enviados]);
      if (enviados.length < validos.length || grandesDemais > 0) {
        setStatus("Algum arquivo não pôde ser enviado — tente de novo ou use o link do Drive.");
      } else {
        setStatus("");
      }
    })();
  };

  const adicionarLink = () => {
    const link = linkInput.trim();
    if (!link) return;
    onChange([...lista, { link, fileName: link.split("/").pop()?.split("?")[0] || "Link" }]);
    setLinkInput("");
  };

  const remover = (idx) => onChange(lista.filter((_, i) => i !== idx));

  return (
    <div className="mb-3">
      <FieldLabel>{label}</FieldLabel>
      <div className="flex gap-2 -mt-1 mb-2">
        <input
          style={{ ...inputStyle, marginBottom: 0 }}
          value={linkInput}
          onChange={(e) => setLinkInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), adicionarLink())}
          placeholder="Cole o link (Drive, etc.) e toque em +"
        />
        <button
          type="button"
          onClick={adicionarLink}
          className="rounded-xl px-3 text-sm font-semibold flex-shrink-0"
          style={{ border: `1px solid ${theme.outline}`, color: theme.outlineText }}
        >
          +
        </button>
      </div>
      <input ref={inputRef} type="file" multiple onChange={handleFiles} style={{ display: "none" }} />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="text-xs font-semibold rounded-xl px-3 py-1.5 mb-2"
        style={{ border: `1px solid ${theme.outline}`, color: theme.outlineText }}
      >
        Anexar arquivo(s)
      </button>
      {lista.length > 0 && (
        <div className="flex flex-col gap-1.5 mb-1">
          {lista.map((a, i) => (
            <div key={i} className="flex items-center justify-between gap-2 rounded-xl px-3 py-1.5" style={{ background: theme.card2 }}>
              <a
                href={a.link}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-semibold flex items-center gap-1 min-w-0"
                style={{ color: theme.mint }}
              >
                <FileText size={12} className="flex-shrink-0" />
                <span className="truncate">{a.fileName || `Anexo ${i + 1}`}</span>
              </a>
              <button type="button" onClick={() => remover(i)} className="mbr-hover-grow flex-shrink-0" style={{ color: theme.coral }}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
      {status && (
        <div className="text-xs mt-1" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
          {status}
        </div>
      )}
    </div>
  );
}

/* ===========================================================
   CLIENTES
=========================================================== */
function emptyCliente() {
  return {
    id: uid(),
    nome: "",
    cpfCnpj: "",
    telefone: "",
    email: "",
    cep: "",
    logradouro: "",
    numero: "",
    complemento: "",
    bairro: "",
    cidade: "",
    estado: "",
    observacoes: "",
  };
}

function ClienteFormModal({ cliente, onClose, onSave, title }) {
  const [form, setForm] = useState(cliente);
  const [cepStatus, setCepStatus] = useState(""); // "" | "buscando" | "ok" | "nao-encontrado"
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const handleCepBlur = async () => {
    const digits = (form.cep || "").replace(/\D/g, "");
    if (digits.length !== 8) return;
    setCepStatus("buscando");
    const endereco = await buscarEnderecoPorCEP(form.cep);
    if (!endereco) {
      setCepStatus("nao-encontrado");
      return;
    }
    setForm((f) => ({
      ...f,
      logradouro: endereco.logradouro || f.logradouro,
      bairro: endereco.bairro || f.bairro,
      cidade: endereco.cidade || f.cidade,
      estado: endereco.estado || f.estado,
    }));
    setCepStatus("ok");
  };

  return (
    <Modal title={title} onClose={onClose}>
      <FieldLabel>Nome completo</FieldLabel>
      <input style={inputStyle} value={form.nome} onChange={set("nome")} />
      <FieldLabel>CPF ou CNPJ</FieldLabel>
      <input
        style={inputStyle}
        value={form.cpfCnpj}
        onChange={(e) => setForm({ ...form, cpfCnpj: maskCpfCnpj(e.target.value) })}
        inputMode="numeric"
        placeholder="000.000.000-00"
      />
      <Row2>
        <div>
          <FieldLabel>Telefone</FieldLabel>
          <input
            style={inputStyle}
            value={form.telefone}
            onChange={(e) => setForm({ ...form, telefone: maskTelefone(e.target.value) })}
            inputMode="numeric"
            placeholder="(11) 90000-0000"
          />
        </div>
        <div>
          <FieldLabel>E-mail</FieldLabel>
          <input style={inputStyle} value={form.email} onChange={set("email")} />
        </div>
      </Row2>
      <FieldLabel>CEP</FieldLabel>
      <input
        style={inputStyle}
        value={form.cep}
        onChange={(e) => setForm({ ...form, cep: maskCep(e.target.value) })}
        onBlur={handleCepBlur}
        placeholder="00000-000"
        inputMode="numeric"
      />
      {cepStatus === "buscando" && (
        <div className="text-xs -mt-2 mb-3" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
          Buscando endereço...
        </div>
      )}
      {cepStatus === "nao-encontrado" && (
        <div className="text-xs -mt-2 mb-3" style={{ color: theme.coral, fontFamily: BODY_FONT }}>
          CEP não encontrado — preencha o endereço manualmente.
        </div>
      )}
      <FieldLabel>Logradouro</FieldLabel>
      <input style={inputStyle} value={form.logradouro} onChange={set("logradouro")} placeholder="Rua / Av." />
      <Row2>
        <div>
          <FieldLabel>Número</FieldLabel>
          <input style={inputStyle} value={form.numero} onChange={set("numero")} />
        </div>
        <div>
          <FieldLabel>Complemento</FieldLabel>
          <input style={inputStyle} value={form.complemento} onChange={set("complemento")} placeholder="Apto, bloco..." />
        </div>
      </Row2>
      <FieldLabel>Bairro</FieldLabel>
      <input style={inputStyle} value={form.bairro} onChange={set("bairro")} />
      <Row2>
        <div>
          <FieldLabel>Cidade</FieldLabel>
          <input style={inputStyle} value={form.cidade} onChange={set("cidade")} />
        </div>
        <div>
          <FieldLabel>Estado</FieldLabel>
          <input
            style={inputStyle}
            value={form.estado}
            onChange={(e) => setForm({ ...form, estado: e.target.value.toUpperCase().slice(0, 2) })}
            placeholder="SP"
            maxLength={2}
          />
        </div>
      </Row2>
      <button onClick={() => onSave(form)} className="w-full rounded-xl py-2 font-semibold mt-1" style={{ background: theme.mint, color: theme.text, fontWeight: 600 }}>
        Salvar
      </button>
    </Modal>
  );
}

function VincularMotoModal({ cliente, motosDisponiveis, onClose, onSave }) {
  const [contratoId] = useState(uid());
  const [motoId, setMotoId] = useState(motosDisponiveis[0]?.id || "");
  const motoSelecionada = motosDisponiveis.find((m) => m.id === motoId);
  const nDefault = (motoSelecionada?.historicoContratos?.length || 0) + 1;
  const [contrato, setContrato] = useState({
    numeroContrato: nDefault,
    numeroClienteMoto: nDefault,
    valorMensal: "",
    formaPagamento: "Boleto Bancário",
    dataInicio: todayISO(),
    diaVencimento: "",
    dataTermino: "",
    anexos: [],
  });
  const setC = (k) => (e) => setContrato({ ...contrato, [k]: e.target.value });

  if (motosDisponiveis.length === 0) {
    return (
      <Modal title={`Vincular moto — ${cliente.nome || "cliente"}`} onClose={onClose}>
        <div style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
          Nenhuma moto disponível agora. Cadastre uma moto nova ou encerre o contrato de alguma na aba Motos primeiro.
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={`Vincular moto — ${cliente.nome || "cliente"}`} onClose={onClose}>
      <FieldLabel>Moto disponível</FieldLabel>
      <SelectField
        value={motoId}
        onChange={(e) => setMotoId(e.target.value)}
        options={motosDisponiveis.map((m) => ({ value: m.id, label: `${m.placa ? formatPlaca(m.placa) : "sem placa"} — ${m.modelo || "modelo?"}` }))}
      />
      <Row2>
        <div>
          <FieldLabel>Nº deste contrato (moto)</FieldLabel>
          <input type="number" min="1" style={inputStyle} value={contrato.numeroContrato} onChange={setC("numeroContrato")} />
        </div>
        <div>
          <FieldLabel>Nº do cliente (moto)</FieldLabel>
          <input type="number" min="1" style={inputStyle} value={contrato.numeroClienteMoto} onChange={setC("numeroClienteMoto")} />
        </div>
      </Row2>
      <Row2>
        <div>
          <FieldLabel>Início</FieldLabel>
          <input type="date" style={dateInputStyle} value={contrato.dataInicio} onChange={setC("dataInicio")} />
        </div>
        <div>
          <FieldLabel>Dia de vencimento</FieldLabel>
          <SelectField
            value={contrato.diaVencimento || ""}
            onChange={setC("diaVencimento")}
            options={[
              { value: "", label: "Selecione o dia" },
              ...Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: `Dia ${i + 1}` })),
            ]}
          />
        </div>
      </Row2>
      <FieldLabel>Data de término (opcional)</FieldLabel>
      <input type="date" style={dateInputStyle} value={contrato.dataTermino || ""} onChange={setC("dataTermino")} />
      <div className="text-xs -mt-2 mb-3" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
        Se o aluguel tiver prazo definido, preenche aqui — assim a previsão em "Futuros" soma só até essa data. Deixe em branco se for indefinido.
      </div>
      <Row2>
        <div>
          <FieldLabel>Valor mensal</FieldLabel>
          <input type="number" step="0.01" style={inputStyle} value={contrato.valorMensal} onChange={setC("valorMensal")} />
        </div>
        <div>
          <FieldLabel>Forma de pagamento</FieldLabel>
          <input style={inputStyle} value={contrato.formaPagamento} onChange={setC("formaPagamento")} />
        </div>
      </Row2>
      <AnexoMultiField
        label="Contrato assinado"
        anexos={contrato.anexos}
        storageKey={`mobirelli-arquivo-contrato-${contratoId}`}
        onChange={(anexos) => setContrato({ ...contrato, anexos })}
      />
      <button
        onClick={() =>
          onSave({ motoId, contrato: { ...contrato, id: contratoId, valorMensal: Number(contrato.valorMensal) || 0 } })
        }
        className="w-full rounded-xl py-2 font-semibold mt-1"
        style={{ background: theme.mint, color: theme.text, fontWeight: 600 }}
      >
        Confirmar vínculo
      </button>
    </Modal>
  );
}

function ClientesView({ clientes, persistClientes, motos, persistMotos }) {
  const [busca, setBusca] = useState("");
  const [modal, setModal] = useState(null);
  const [expandido, setExpandido] = useState(null);
  const [preview, setPreview] = useState(null);

  const salvar = async (cliente) => {
    const existe = clientes.find((c) => c.id === cliente.id);
    const next = existe ? clientes.map((c) => (c.id === cliente.id ? cliente : c)) : [...clientes, cliente];
    await persistClientes(next);
    setModal(null);
  };

  const excluir = async (id) => persistClientes(clientes.filter((c) => c.id !== id));

  const vincularMoto = async (cliente, dados) => {
    const moto = motos.find((m) => m.id === dados.motoId);
    if (!moto) return;
    const atualizada = { ...moto, status: "alugada", contratoAtual: { ...dados.contrato, clienteId: cliente.id } };
    await persistMotos(motos.map((m) => (m.id === moto.id ? atualizada : m)));
    setModal(null);
  };

  const atualizarContrato = async (moto, dados) => {
    await persistMotos(motos.map((m) => (m.id === moto.id ? { ...m, contratoAtual: { ...m.contratoAtual, ...dados.contrato } } : m)));
    setModal(null);
  };

  const filtrados = clientes.filter((c) => {
    const q = busca.toLowerCase();
    return !q || c.nome?.toLowerCase().includes(q) || c.cpfCnpj?.toLowerCase().includes(q);
  });
  const semMotoAgora = clientes.filter((c) => !motos.some((m) => m.contratoAtual?.clienteId === c.id)).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 style={{ fontFamily: HEAD_FONT, fontSize: 22, fontWeight: 700, color: theme.mint }}>Clientes</h2>
        {permissoes.podeEditar && (
          <button
            onClick={() => setModal({ mode: "novo", cliente: emptyCliente() })}
            className="flex items-center gap-1 rounded-xl px-3 py-2 text-sm font-semibold"
            style={{ background: theme.mint, color: theme.text, fontWeight: 600 }}
          >
            <Plus size={16} /> Novo cliente
          </button>
        )}
      </div>
      <div className="text-xs mb-3" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
        {clientes.length} cliente{clientes.length === 1 ? "" : "s"}
        {" · "}
        {semMotoAgora} sem moto no momento
      </div>

      <div className="relative mb-4">
        <Search size={15} style={{ position: "absolute", left: 10, top: 10, color: theme.textMuted }} />
        <input
          style={{ ...inputStyle, paddingLeft: 32, marginBottom: 0 }}
          placeholder="Buscar por nome ou CPF/CNPJ"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
      </div>

      {filtrados.length === 0 && (
        <div className="rounded-2xl p-6 text-center" style={{ background: theme.card, color: theme.textMuted, fontFamily: BODY_FONT }}>
          Nenhum cliente encontrado.
        </div>
      )}

      <div className="flex flex-col gap-2">
        {filtrados.map((c) => {
          const motoVinculada = motos.find((m) => m.contratoAtual?.clienteId === c.id);
          const aberto = expandido === c.id;
          return (
            <div key={c.id} className="rounded-2xl overflow-hidden" style={{ background: theme.card, border: `1px solid ${theme.cardBorder}` }}>
              <button className="w-full flex items-center gap-3 justify-between px-4 py-3 text-left" onClick={() => setExpandido(aberto ? null : c.id)}>
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="flex items-center justify-center flex-shrink-0"
                    style={{ width: 28, height: 28, borderRadius: 8, background: theme.card2 }}
                  >
                    <Users size={16} color={motoVinculada ? theme.mint : theme.textGhost} />
                  </div>
                  <div className="flex flex-col gap-1.5 min-w-0">
                    <div style={{ fontFamily: HEAD_FONT, fontSize: 17, color: theme.text }}>{c.nome || "Sem nome"}</div>
                    {motoVinculada ? (
                      <Badge color={theme.mint} icon={Bike} label={`Com a moto ${formatPlaca(motoVinculada.placa)}`} />
                    ) : (
                      <Badge color={theme.amber} icon={Clock} label="Sem moto no momento" />
                    )}
                  </div>
                </div>
                {aberto ? <ChevronUp size={18} color={theme.textMuted} /> : <ChevronDown size={18} color={theme.textMuted} />}
              </button>

              <Collapse open={aberto}>
                <div className="px-4 pb-4 text-sm" style={{ fontFamily: BODY_FONT }}>
                  {motoVinculada ? (
                    <div className="mb-5">
                      <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: theme.textFaint }}>
                        Contrato ativo
                      </div>
                      <div className="rounded-xl p-3" style={{ background: theme.card2 }}>
                        <div className="flex items-center justify-between mb-1">
                          <MotoPlate placa={motoVinculada.placa} />
                          <span style={{ color: theme.amber, fontFamily: HEAD_FONT, fontSize: 17 }}>
                            {formatCurrency(motoVinculada.contratoAtual.valorMensal)}/mês
                          </span>
                        </div>
                        <div style={{ color: theme.textMuted, fontSize: 12 }}>
                          Contrato nº {motoVinculada.contratoAtual.numeroContrato}
                          {diaVencimentoDoContrato(motoVinculada.contratoAtual) && ` · pagamento todo dia ${diaVencimentoDoContrato(motoVinculada.contratoAtual)}`}
                          {motoVinculada.contratoAtual.dataTermino && ` · até ${formatDate(motoVinculada.contratoAtual.dataTermino)}`}
                        </div>
                        <div className="flex items-center gap-3 mt-2 flex-wrap">
                          <ContratoAnexosButton
                            anexos={contratoAnexosOf(motoVinculada.contratoAtual)}
                            tituloPreview={`Contrato — ${formatPlaca(motoVinculada.placa)}`}
                            onAbrir={(url, title) => setPreview({ url, title })}
                          />
                          {permissoes.podeEditar && (
                            <button
                              onClick={() => setModal({ type: "contrato", moto: motoVinculada })}
                              className="inline-flex items-center gap-1 text-xs mbr-hover-grow"
                              style={{ color: theme.text }}
                            >
                              <Pencil size={12} /> Editar contrato
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    permissoes.podeEditar && (
                      <div className="mb-5">
                        <button
                          onClick={() => setModal({ mode: "vincular", cliente: c })}
                          className="text-xs font-semibold rounded-xl px-3"
                          style={{ background: theme.mint, color: theme.text, minHeight: 44 }}
                        >
                          Vincular a uma moto disponível
                        </button>
                      </div>
                    )
                  )}

                  <div className="mb-5">
                    <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: theme.textFaint }}>
                      Contato
                    </div>
                    <div className="flex flex-col gap-1.5" style={{ color: theme.textMuted }}>
                      {c.cpfCnpj && <span>CPF/CNPJ: {c.cpfCnpj}</span>}
                      {c.telefone && (
                        <span className="flex items-center gap-1">
                          <Phone size={12} /> {c.telefone}
                        </span>
                      )}
                      {c.email && (
                        <span className="flex items-center gap-1">
                          <Mail size={12} /> {c.email}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <MapPin size={12} /> {enderecoCompleto(c)} {c.cep ? `— CEP ${c.cep}` : ""}
                      </span>
                    </div>
                  </div>

                  {permissoes.podeEditar && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => setModal({ mode: "editar", cliente: c })}
                        className="text-xs font-semibold rounded-xl px-3 py-1.5 flex items-center gap-1"
                        style={{ border: `1px solid ${theme.outline}`, color: theme.outlineText }}
                      >
                        <Pencil size={12} /> Editar
                      </button>
                      {!motoVinculada && (
                        <button
                          onClick={() => excluir(c.id)}
                          className="text-xs font-semibold rounded-xl px-3 py-1.5 flex items-center gap-1"
                          style={{ border: `1px solid ${theme.cardBorder}`, color: theme.coral }}
                        >
                          <Trash2 size={12} /> Excluir
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </Collapse>
            </div>
          );
        })}
      </div>

      {(modal?.mode === "novo" || modal?.mode === "editar") && (
        <ClienteFormModal
          title={modal.mode === "novo" ? "Cadastrar cliente" : "Editar cliente"}
          cliente={modal.cliente}
          onClose={() => setModal(null)}
          onSave={salvar}
        />
      )}
      {modal?.mode === "vincular" && (
        <VincularMotoModal
          cliente={modal.cliente}
          motosDisponiveis={motos.filter((m) => m.status === "disponivel")}
          onClose={() => setModal(null)}
          onSave={(dados) => vincularMoto(modal.cliente, dados)}
        />
      )}
      {modal?.type === "contrato" && (
        <ContratoModal
          moto={modal.moto}
          clientes={clientes}
          editando
          onClose={() => setModal(null)}
          onSave={(dados) => atualizarContrato(modal.moto, dados)}
        />
      )}
      {preview && <PdfViewer url={preview.url} title={preview.title} onClose={() => setPreview(null)} />}
    </div>
  );
}

/* ===========================================================
   MOTOS
=========================================================== */
function emptyMoto() {
  return {
    id: uid(),
    modelo: "",
    placa: "",
    chassi: "",
    renavam: "",
    dataCompra: todayISO(),
    nfNumero: "",
    valorCompra: "",
    notaFiscalAnexos: [],
    notaFiscalFabricaAnexos: [],
    documentoLink: "",
    documentoArquivo: "",
    certificadoLink: "",
    certificadoArquivo: "",
    linkRastreamento: "",
    status: "preparacao",
    contratoAtual: null,
    historicoContratos: [],
    manutencoes: [],
    custosExtras: [],
  };
}

/* ===========================================================
   RASTREIO — mapa próprio (Leaflet + tiles em tons de cinza), sem
   usar a tela da Melocaliza: só puxamos as coordenadas (endpoint público
   por trás do link de "Compartilhar localização") e desenhamos com a
   cara do nosso app.
=========================================================== */
const RASTREIO_HASH_PADRAO = "126b3fd40579524296cf586b7625cd97";

function itemsUrlFromLink(link) {
  const m = (link || "").match(/sharing\/([a-f0-9]+)/i);
  const hash = m ? m[1] : RASTREIO_HASH_PADRAO;
  return `https://web.melocaliza.com.br/sharing/${hash}/items`;
}

const RASTREIO_STATUS_COR = {
  green: theme.mint,
  yellow: theme.amber,
  red: theme.coral,
  black: theme.textMuted,
};

const RASTREIO_LEGENDA = [
  { cor: "green", label: "Em movimento" },
  { cor: "yellow", label: "Parada" },
  { cor: "red", label: "Offline" },
];

function rastreioMarkerHtml(placa, corHex) {
  const rotulo = `<div style="background:${theme.card2};border-radius:6px;padding:2px 7px;display:flex;align-items:center;white-space:nowrap;"><span style="font-family:${MONO_FONT};font-weight:500;font-size:11px;letter-spacing:0.5px;color:${theme.text};">${formatPlaca(placa)}</span></div>`;
  return `
    <div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
      <div style="width:13px;height:13px;border-radius:50%;background:${corHex};box-shadow:0 0 0 5px ${corHex}33,0 1px 3px rgba(0,0,0,0.5);"></div>
      ${rotulo}
    </div>
  `;
}

function rastreioPopupHtml(placa, device, moto, clienteNome) {
  const cor = RASTREIO_STATUS_COR[device?.icon_color] || theme.mint;
  const velocidade = Number(device?.speed) || 0;
  const statusTxt = device?.online === "offline" ? "Offline" : velocidade > 0 ? `Em movimento · ${Math.round(velocidade)} km/h` : "Parada";
  const modelo = moto?.modelo ? `<div style="font-size:12px;color:${theme.textMuted};margin-top:2px;">${moto.modelo}</div>` : "";
  const contrato = moto?.contratoAtual
    ? `<div style="margin-top:6px;padding-top:6px;border-top:1px solid ${theme.divider};font-size:12px;color:${theme.textMuted};">
         ${clienteNome ? `Cliente: <b style="color:${theme.text}">${clienteNome}</b><br/>` : ""}
         <span style="color:${theme.amber};font-weight:700;">${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(moto.contratoAtual.valorMensal || 0)}</span>/mês
       </div>`
    : "";
  return `
    <div style="font-family:${BODY_FONT};min-width:150px;">
      <div style="display:flex;align-items:center;"><span style="font-family:${MONO_FONT};font-weight:500;font-size:14px;letter-spacing:1px;color:${theme.text};">${formatPlaca(placa)}</span></div>
      ${modelo}
      <div style="font-size:12px;margin-top:4px;color:${cor};font-weight:600;">${statusTxt}</div>
      ${contrato}
    </div>
  `;
}

// borrão progressivo — usado nas barras de cima/baixo do Rastreio, que ficam por
// cima do mapa (não de um fundo sólido). Backdrop-filter só aceita um valor fixo de
// blur por elemento, então pra simular um borrão que vai AUMENTANDO conforme chega
// na borda da tela (em vez de um borrão uniforme), empilha várias camadas com o
// mesmo blur, cada uma "revelada" (via máscara) só numa faixa cada vez mais estreita
// perto da borda — perto da borda várias camadas se somam (mais borrado), perto de
// onde o degradê de opacidade começa nenhuma camada aparece (sem blur, nítido)
function BorraProgressiva({ lado }) {
  const camadas =
    lado === "topo"
      ? [
          { ate: 60, fim: 78 },
          { ate: 45, fim: 62 },
          { ate: 30, fim: 46 },
          { ate: 12, fim: 30 },
        ]
      : [
          { de: 40, inicio: 22 },
          { de: 55, inicio: 38 },
          { de: 70, inicio: 54 },
          { de: 88, inicio: 70 },
        ];
  return (
    <div className="absolute inset-0" style={{ zIndex: -1, pointerEvents: "none" }}>
      {camadas.map((c, i) => {
        const mask =
          lado === "topo"
            ? `linear-gradient(to bottom, #000 0%, #000 ${c.ate}%, transparent ${c.fim}%)`
            : `linear-gradient(to bottom, transparent ${c.inicio}%, #000 ${c.de}%, #000 100%)`;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              inset: 0,
              backdropFilter: "blur(0.8px)",
              WebkitBackdropFilter: "blur(0.8px)",
              maskImage: mask,
              WebkitMaskImage: mask,
            }}
          />
        );
      })}
    </div>
  );
}

function MapToolButton({ icon: Icon, label, onClick, active }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className="flex items-center justify-center rounded-full mbr-hover-grow"
      style={{
        width: 34,
        height: 34,
        background: active ? theme.mint : hexToRgba(theme.card, 0.92),
        color: active ? theme.mintText : theme.text,
        border: `1px solid ${theme.cardBorder}`,
        boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
      }}
    >
      <Icon size={16} />
    </button>
  );
}

function TrackingMap({ link, filterPlaca, height = 320, rounded = true, motos, clientes, topInset = 0, bottomInset = 0 }) {
  const containerRef = useRef(null);
  const mapObjRef = useRef(null);
  const markersRef = useRef({});
  const popupRef = useRef(null);
  const popupChaveRef = useRef(null);
  const tickRef = useRef(null);
  const primeiraCargaRef = useRef(true);
  const seguindoRef = useRef(null);
  const mostrarRastroRef = useRef(false);
  const motosRef = useRef(motos);
  const clientesRef = useRef(clientes);
  const [status, setStatus] = useState("carregando"); // carregando | ok | erro
  const [mostrarRastro, setMostrarRastro] = useState(false);

  useEffect(() => {
    mostrarRastroRef.current = mostrarRastro;
  }, [mostrarRastro]);

  useEffect(() => {
    motosRef.current = motos;
  }, [motos]);

  useEffect(() => {
    clientesRef.current = clientes;
  }, [clientes]);

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    primeiraCargaRef.current = true;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: mapStyle,
      center: [-47.0, -22.9],
      zoom: 6,
      attributionControl: false,
    });
    mapObjRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    // atribuição ao OpenStreetMap/MapLibre é exigida pela licença dos dados do mapa —
    // "compact" mantém isso, só troca a faixa cheia por um botão discreto "i"
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    // se a pessoa arrastar o mapa ou der zoom manualmente, para de seguir a moto —
    // "originalEvent" só existe quando o movimento veio de um gesto do usuário (mouse/touch/
    // scroll); os recentramentos automáticos (flyTo/easeTo) não disparam esses eventos
    const pararDeSeguir = (e) => {
      if (e.originalEvent) seguindoRef.current = null;
    };
    map.on("dragstart", pararDeSeguir);
    map.on("zoomstart", pararDeSeguir);

    async function tick() {
      try {
        const res = await fetch(itemsUrlFromLink(link));
        const data = await res.json();
        if (cancelled) return;

        const devices = Object.values(data).filter((d) =>
          filterPlaca ? (d.name || "").toUpperCase().startsWith(filterPlaca.toUpperCase()) : true
        );

        const bounds = new maplibregl.LngLatBounds();
        const vistos = new Set();

        devices.forEach((d) => {
          const lat = parseFloat(d.lat);
          const lng = parseFloat(d.lng);
          if (!lat || !lng) return;
          const chave = String(d.id);
          vistos.add(chave);
          const placa = (d.name || "").split(" - ")[0].trim();
          const cor = RASTREIO_STATUS_COR[d.icon_color] || theme.mint;

          if (markersRef.current[chave]) {
            markersRef.current[chave].marker.setLngLat([lng, lat]);
            markersRef.current[chave].placa = placa;
            markersRef.current[chave].cor = cor;
            markersRef.current[chave].device = d;
            if (seguindoRef.current === chave) {
              map.easeTo({ center: [lng, lat], duration: 900 });
            }
            // se o popup aberto é o dessa moto, ele também acompanha — sem isso, a câmera
            // seguia o ícone mas o balão de informações (com a velocidade) ficava parado
            // no lugar antigo, "descolando" da moto conforme ela andava
            if (popupChaveRef.current === chave && popupRef.current) {
              popupRef.current.setLngLat([lng, lat]);
              const moto = motosRef.current?.find((m) => (m.placa || "").toUpperCase() === placa.toUpperCase());
              const cliente = moto?.contratoAtual ? clientesRef.current?.find((c) => c.id === moto.contratoAtual.clienteId) : null;
              popupRef.current.setHTML(rastreioPopupHtml(placa, d, moto, cliente?.nome));
            }
          } else {
            const el = document.createElement("div");
            el.className = "mbr-map-marker";
            el.innerHTML = rastreioMarkerHtml(placa, cor);
            const marker = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([lng, lat]).addTo(map);
            markersRef.current[chave] = { marker, placa, cor, device: d };

            el.addEventListener("click", (ev) => {
              ev.stopPropagation();
              const entry = markersRef.current[chave];
              if (!entry) return;
              const ll = entry.marker.getLngLat();
              // ao clicar numa moto, a câmera passa a "segui-la": a cada atualização de
              // posição (tick) ela recentraliza sozinha, até a pessoa arrastar/dar zoom
              // manualmente no mapa (aí para de seguir — ver listeners de dragstart/zoomstart)
              seguindoRef.current = chave;
              map.flyTo({ center: ll, zoom: 16, duration: 600 });

              const moto = motosRef.current?.find((m) => (m.placa || "").toUpperCase() === entry.placa.toUpperCase());
              const cliente = moto?.contratoAtual ? clientesRef.current?.find((c) => c.id === moto.contratoAtual.clienteId) : null;

              if (popupRef.current) popupRef.current.remove();
              popupChaveRef.current = chave;
              // o pino (bolinha + etiqueta da placa) tem ~37px de altura acima do ponto —
              // offset menor que isso fazia o popup tampar um pouco o ícone; com 48px sobra
              // uma folguinha e o ícone fica 100% visível abaixo do balão
              popupRef.current = new maplibregl.Popup({ closeButton: true, offset: 48, className: "mbr-map-popup" })
                .setLngLat(ll)
                .setHTML(rastreioPopupHtml(entry.placa, entry.device, moto, cliente?.nome))
                .addTo(map);
              popupRef.current.on("close", () => {
                if (popupChaveRef.current === chave) popupChaveRef.current = null;
              });
            });
          }
          bounds.extend([lng, lat]);

          if (map.isStyleLoaded()) {
            const srcId = `trail-${chave}`;
            const coords = (d.tail || [])
              .map((p) => [parseFloat(p.lng), parseFloat(p.lat)])
              .filter(([lo, la]) => lo && la);
            const geojson = { type: "Feature", geometry: { type: "LineString", coordinates: coords } };
            const existente = map.getSource(srcId);
            if (existente) {
              existente.setData(geojson);
            } else if (coords.length > 1) {
              map.addSource(srcId, { type: "geojson", data: geojson });
              map.addLayer({
                id: `trail-line-${chave}`,
                type: "line",
                source: srcId,
                layout: { visibility: mostrarRastroRef.current ? "visible" : "none" },
                paint: { "line-color": theme.mint, "line-width": 2.5, "line-opacity": 0.55 },
              });
            }
          }
        });

        Object.keys(markersRef.current).forEach((chave) => {
          if (!vistos.has(chave)) {
            markersRef.current[chave].marker.remove();
            delete markersRef.current[chave];
            if (seguindoRef.current === chave) seguindoRef.current = null;
            if (popupChaveRef.current === chave) {
              popupRef.current?.remove();
              popupChaveRef.current = null;
            }
          }
        });

        // só centraliza sozinho na primeira vez que carrega — do contrário, a cada
        // atualização (a cada 20s) ele puxava o mapa de volta e desfazia o zoom/posição
        // que a pessoa tinha ajustado manualmente (ex: clicar numa moto pra acompanhar
        // ela de perto). Depois disso, só recentraliza no botão "Centralizar".
        if (!bounds.isEmpty() && primeiraCargaRef.current) {
          primeiraCargaRef.current = false;
          if (devices.length === 1) {
            map.easeTo({ center: bounds.getCenter(), zoom: 12, duration: 500 });
          } else {
            // padding maior no topo/base — os pinos têm uma etiqueta desenhada por cima
            // (não contabilizada pelo fitBounds, que só olha as coordenadas do ponto) e o
            // cabeçalho/menu inferior "flutuam" sobre o mapa, então sem essa folga extra
            // os marcadores das pontas ficavam escondidos atrás desses elementos
            map.fitBounds(bounds, {
              padding: { top: 90 + topInset, bottom: 50 + bottomInset, left: 60, right: 60 },
              maxZoom: 12,
              duration: 500,
            });
          }
        }

        setStatus("ok");
      } catch {
        if (!cancelled) setStatus("erro");
      }
    }

    tickRef.current = tick;
    map.on("load", tick);
    const interval = setInterval(tick, 20000);

    return () => {
      cancelled = true;
      clearInterval(interval);
      Object.values(markersRef.current).forEach(({ marker }) => marker.remove());
      markersRef.current = {};
      popupRef.current?.remove();
      popupRef.current = null;
      map.remove();
      mapObjRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link, filterPlaca]);

  const centralizar = () => {
    seguindoRef.current = null;
    const map = mapObjRef.current;
    const marcadores = Object.values(markersRef.current).map((m) => m.marker);
    if (!map || marcadores.length === 0) return;
    if (marcadores.length === 1) {
      map.flyTo({ center: marcadores[0].getLngLat(), zoom: 12 });
      return;
    }
    const bounds = new maplibregl.LngLatBounds();
    marcadores.forEach((mk) => bounds.extend(mk.getLngLat()));
    map.fitBounds(bounds, {
      padding: { top: 90 + topInset, bottom: 50 + bottomInset, left: 60, right: 60 },
      maxZoom: 12,
      duration: 500,
    });
  };

  const alternarRastro = () => {
    const novo = !mostrarRastro;
    setMostrarRastro(novo);
    const map = mapObjRef.current;
    if (!map) return;
    (map.getStyle()?.layers || []).forEach((l) => {
      if (l.id.startsWith("trail-line-")) {
        map.setLayoutProperty(l.id, "visibility", novo ? "visible" : "none");
      }
    });
  };

  return (
    <div
      className={rounded ? "mbr-map rounded-2xl overflow-hidden relative" : "mbr-map overflow-hidden relative"}
      style={{
        border: rounded ? `1px solid ${theme.cardBorder}` : "none",
        height,
        "--mbr-top-inset": `${topInset}px`,
        "--mbr-bottom-inset": `${bottomInset}px`,
      }}
    >
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      <div className="absolute left-3 flex gap-3 z-10" style={{ top: 12 + topInset }}>
        <MapToolButton icon={Crosshair} label="Centralizar" onClick={centralizar} />
        <MapToolButton icon={Route} label="Mostrar rastro" active={mostrarRastro} onClick={alternarRastro} />
        <MapToolButton icon={RefreshCw} label="Atualizar agora" onClick={() => tickRef.current?.()} />
      </div>

      <div
        className="absolute left-3 rounded-xl px-3 py-2 flex flex-col gap-1 z-10"
        style={{ bottom: 12 + bottomInset, background: hexToRgba(theme.card, 0.92), border: `1px solid ${theme.cardBorder}` }}
      >
        {RASTREIO_LEGENDA.map((l) => (
          <div key={l.cor} className="flex items-center gap-1.5 text-xs" style={{ color: theme.text, fontFamily: BODY_FONT }}>
            <span
              className="rounded-full flex-shrink-0"
              style={{ width: 9, height: 9, background: RASTREIO_STATUS_COR[l.cor] }}
            />
            {l.label}
          </div>
        ))}
      </div>

      {status === "erro" && (
        <div
          className="absolute inset-0 flex items-center justify-center text-xs text-center px-4"
          style={{ color: theme.textMuted, background: theme.card, fontFamily: BODY_FONT }}
        >
          Não foi possível carregar a localização agora.
        </div>
      )}
    </div>
  );
}

function MotoTrackingBlock({ link, placa }) {
  const [aberto, setAberto] = useState(false);
  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-semibold rounded-xl px-3"
        style={{ background: hexToRgba(theme.mint, 0.16), color: theme.mint, minHeight: 44 }}
      >
        <MapPin size={13} /> {aberto ? "Ocultar localização" : "Ver localização em tempo real"}
      </button>
      <Collapse open={aberto}>
        <div className="mt-2">{aberto && <TrackingMap link={link} filterPlaca={placa} height={280} />}</div>
      </Collapse>
    </div>
  );
}

function MotoFormModal({ moto, onClose, onSave, title }) {
  const [form, setForm] = useState({
    ...emptyMoto(),
    ...moto,
    notaFiscalAnexos: notaFiscalAnexosOf(moto),
    notaFiscalFabricaAnexos: notaFiscalFabricaAnexosOf(moto),
  });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <Modal title={title} onClose={onClose}>
      <FieldLabel>Modelo</FieldLabel>
      <input style={inputStyle} value={form.modelo} onChange={set("modelo")} placeholder="JTZ/DK160 S" />
      <Row2>
        <div>
          <FieldLabel>Placa</FieldLabel>
          <input
            style={inputStyle}
            value={formatPlaca(form.placa)}
            onChange={(e) => setForm({ ...form, placa: placaLimpa(e.target.value) })}
            placeholder="URB-5I50"
          />
        </div>
        <div>
          <FieldLabel>Status</FieldLabel>
          <SelectField
            value={form.status}
            onChange={set("status")}
            options={
              form.status === "alugada"
                ? [{ value: "alugada", label: "Alugada (encerre o contrato p/ mudar)" }]
                : [
                    { value: "preparacao", label: "Em preparação" },
                    { value: "disponivel", label: "Disponível" },
                    { value: "manutencao", label: "Em manutenção" },
                  ]
            }
          />
        </div>
      </Row2>
      <Row2>
        <div>
          <FieldLabel>Chassi</FieldLabel>
          <input style={inputStyle} value={form.chassi} onChange={set("chassi")} />
        </div>
        <div>
          <FieldLabel>Renavam</FieldLabel>
          <input style={inputStyle} value={form.renavam} onChange={set("renavam")} />
        </div>
      </Row2>
      <Row2>
        <div>
          <FieldLabel>Data da compra</FieldLabel>
          <input type="date" style={dateInputStyle} value={form.dataCompra} onChange={set("dataCompra")} />
        </div>
        <div>
          <FieldLabel>Valor da compra</FieldLabel>
          <input type="number" step="0.01" style={inputStyle} value={form.valorCompra} onChange={set("valorCompra")} />
        </div>
      </Row2>
      <FieldLabel>Nº da nota fiscal</FieldLabel>
      <input style={inputStyle} value={form.nfNumero} onChange={set("nfNumero")} />
      <AnexoMultiField
        label="Nota fiscal"
        anexos={form.notaFiscalAnexos}
        storageKey={`mobirelli-arquivo-nf-${form.id}`}
        onChange={(anexos) => setForm({ ...form, notaFiscalAnexos: anexos })}
      />
      <AnexoMultiField
        label="Nota fiscal de fábrica"
        anexos={form.notaFiscalFabricaAnexos}
        storageKey={`mobirelli-arquivo-nf-fabrica-${form.id}`}
        onChange={(anexos) => setForm({ ...form, notaFiscalFabricaAnexos: anexos })}
      />
      <AnexoField
        label="Documento da moto (CRLV, etc.)"
        linkValue={form.documentoLink}
        storageKey={`mobirelli-arquivo-doc-${form.id}`}
        fileName={form.documentoArquivo}
        onChange={(v) => setForm({ ...form, documentoLink: v.link, documentoArquivo: v.fileName })}
      />
      <AnexoField
        label="Certificado de garantia"
        linkValue={form.certificadoLink}
        storageKey={`mobirelli-arquivo-cert-${form.id}`}
        fileName={form.certificadoArquivo}
        onChange={(v) => setForm({ ...form, certificadoLink: v.link, certificadoArquivo: v.fileName })}
      />
      <FieldLabel>Link de rastreamento (Melocaliza)</FieldLabel>
      <input
        style={inputStyle}
        value={form.linkRastreamento}
        onChange={set("linkRastreamento")}
        placeholder="https://web.melocaliza.com.br/sharing/..."
      />
      <div className="text-xs -mt-2 mb-3" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
        Na Melocaliza: Compartilhar localização → Novo → escolha esta moto → validade "Nenhum" → copie o link gerado.
      </div>
      <button onClick={() => onSave(form)} className="w-full rounded-xl py-2 font-semibold mt-1" style={{ background: theme.mint, color: theme.text, fontWeight: 600 }}>
        Salvar
      </button>
    </Modal>
  );
}

function ContratoModal({ moto, clientes, onClose, onSave, editando }) {
  const [contratoId] = useState(moto.contratoAtual?.id || uid());
  const [clienteId, setClienteId] = useState("novo");
  const [novoCliente, setNovoCliente] = useState(emptyCliente());
  const nContratoDefault = (moto.historicoContratos?.length || 0) + 1;
  const [contrato, setContrato] = useState(
    editando
      ? {
          dataTermino: "",
          ...moto.contratoAtual,
          diaVencimento: diaVencimentoDoContrato(moto.contratoAtual) || "",
          anexos: contratoAnexosOf(moto.contratoAtual),
        }
      : {
          numeroContrato: nContratoDefault,
          numeroClienteMoto: nContratoDefault,
          valorMensal: "",
          formaPagamento: "Boleto Bancário",
          dataInicio: todayISO(),
          diaVencimento: "",
          dataTermino: "",
          anexos: [],
        }
  );

  const [cepStatus, setCepStatus] = useState(""); // "" | "buscando" | "ok" | "nao-encontrado"
  const setNC = (k) => (e) => setNovoCliente({ ...novoCliente, [k]: e.target.value });
  const setC = (k) => (e) => setContrato({ ...contrato, [k]: e.target.value });

  const handleCepBlur = async () => {
    const digits = (novoCliente.cep || "").replace(/\D/g, "");
    if (digits.length !== 8) return;
    setCepStatus("buscando");
    const endereco = await buscarEnderecoPorCEP(novoCliente.cep);
    if (!endereco) {
      setCepStatus("nao-encontrado");
      return;
    }
    setNovoCliente((c) => ({
      ...c,
      logradouro: endereco.logradouro || c.logradouro,
      bairro: endereco.bairro || c.bairro,
      cidade: endereco.cidade || c.cidade,
      estado: endereco.estado || c.estado,
    }));
    setCepStatus("ok");
  };

  const clienteAtual = editando ? clientes.find((c) => c.id === moto.contratoAtual?.clienteId) : null;

  return (
    <Modal
      title={editando ? `Editar contrato — ${moto.placa ? formatPlaca(moto.placa) : moto.modelo}` : `Novo contrato — ${moto.placa ? formatPlaca(moto.placa) : moto.modelo}`}
      onClose={onClose}
    >
      {editando ? (
        <div className="rounded-xl p-3 mb-3" style={{ background: theme.card2 }}>
          <FieldLabel>Cliente</FieldLabel>
          <div style={{ color: theme.text, fontFamily: BODY_FONT }}>{clienteAtual?.nome || "Cliente"}</div>
          <div className="text-xs mt-1" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
            Pra trocar de cliente, encerre este contrato e cadastre um novo aluguel.
          </div>
        </div>
      ) : (
        <>
      <FieldLabel>Cliente</FieldLabel>
      <SelectField
        value={clienteId}
        onChange={(e) => setClienteId(e.target.value)}
        options={[{ value: "novo", label: "+ Cadastrar novo cliente" }, ...clientes.map((c) => ({ value: c.id, label: c.nome || "Sem nome" }))]}
      />

      {clienteId === "novo" ? (
        <div className="rounded-xl p-3 mb-2" style={{ background: theme.card2 }}>
          <FieldLabel>Nome completo</FieldLabel>
          <input style={inputStyle} value={novoCliente.nome} onChange={setNC("nome")} />
          <FieldLabel>CPF ou CNPJ</FieldLabel>
          <input
            style={inputStyle}
            value={novoCliente.cpfCnpj}
            onChange={(e) => setNovoCliente({ ...novoCliente, cpfCnpj: maskCpfCnpj(e.target.value) })}
            inputMode="numeric"
            placeholder="000.000.000-00"
          />
          <Row2>
            <div>
              <FieldLabel>Telefone</FieldLabel>
              <input
                style={inputStyle}
                value={novoCliente.telefone}
                onChange={(e) => setNovoCliente({ ...novoCliente, telefone: maskTelefone(e.target.value) })}
                inputMode="numeric"
                placeholder="(11) 90000-0000"
              />
            </div>
            <div>
              <FieldLabel>E-mail</FieldLabel>
              <input style={inputStyle} value={novoCliente.email} onChange={setNC("email")} />
            </div>
          </Row2>
          <FieldLabel>CEP</FieldLabel>
          <input
            style={inputStyle}
            value={novoCliente.cep}
            onChange={(e) => setNovoCliente({ ...novoCliente, cep: maskCep(e.target.value) })}
            onBlur={handleCepBlur}
            placeholder="00000-000"
            inputMode="numeric"
          />
          {cepStatus === "buscando" && (
            <div className="text-xs -mt-2 mb-3" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
              Buscando endereço...
            </div>
          )}
          {cepStatus === "nao-encontrado" && (
            <div className="text-xs -mt-2 mb-3" style={{ color: theme.coral, fontFamily: BODY_FONT }}>
              CEP não encontrado — preencha o endereço manualmente.
            </div>
          )}
          <FieldLabel>Logradouro</FieldLabel>
          <input style={inputStyle} value={novoCliente.logradouro} onChange={setNC("logradouro")} />
          <Row2>
            <div>
              <FieldLabel>Número</FieldLabel>
              <input style={inputStyle} value={novoCliente.numero} onChange={setNC("numero")} />
            </div>
            <div>
              <FieldLabel>Complemento</FieldLabel>
              <input style={inputStyle} value={novoCliente.complemento} onChange={setNC("complemento")} placeholder="Apto, bloco..." />
            </div>
          </Row2>
          <FieldLabel>Bairro</FieldLabel>
          <input style={inputStyle} value={novoCliente.bairro} onChange={setNC("bairro")} />
          <Row2>
            <div>
              <FieldLabel>Cidade</FieldLabel>
              <input style={inputStyle} value={novoCliente.cidade} onChange={setNC("cidade")} />
            </div>
            <div>
              <FieldLabel>Estado</FieldLabel>
              <input
                style={inputStyle}
                value={novoCliente.estado}
                onChange={(e) => setNovoCliente({ ...novoCliente, estado: e.target.value.toUpperCase().slice(0, 2) })}
                placeholder="SP"
                maxLength={2}
              />
            </div>
          </Row2>
        </div>
      ) : null}
        </>
      )}

      <Row2>
        <div>
          <FieldLabel>Nº deste contrato (moto)</FieldLabel>
          <input type="number" min="1" style={inputStyle} value={contrato.numeroContrato} onChange={setC("numeroContrato")} />
        </div>
        <div>
          <FieldLabel>Nº do cliente (moto)</FieldLabel>
          <input type="number" min="1" style={inputStyle} value={contrato.numeroClienteMoto} onChange={setC("numeroClienteMoto")} />
        </div>
      </Row2>
      <Row2>
        <div>
          <FieldLabel>Início</FieldLabel>
          <input type="date" style={dateInputStyle} value={contrato.dataInicio} onChange={setC("dataInicio")} />
        </div>
        <div>
          <FieldLabel>Dia de vencimento</FieldLabel>
          <SelectField
            value={contrato.diaVencimento || ""}
            onChange={setC("diaVencimento")}
            options={[
              { value: "", label: "Selecione o dia" },
              ...Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: `Dia ${i + 1}` })),
            ]}
          />
        </div>
      </Row2>
      <FieldLabel>Data de término (opcional)</FieldLabel>
      <input type="date" style={dateInputStyle} value={contrato.dataTermino || ""} onChange={setC("dataTermino")} />
      <div className="text-xs -mt-2 mb-3" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
        Se o aluguel tiver prazo definido, preenche aqui — assim a previsão em "Futuros" soma só até essa data. Deixe em branco se for indefinido.
      </div>
      <Row2>
        <div>
          <FieldLabel>Valor mensal</FieldLabel>
          <input type="number" step="0.01" style={inputStyle} value={contrato.valorMensal} onChange={setC("valorMensal")} />
        </div>
        <div>
          <FieldLabel>Forma de pagamento</FieldLabel>
          <input style={inputStyle} value={contrato.formaPagamento} onChange={setC("formaPagamento")} />
        </div>
      </Row2>

      <AnexoMultiField
        label="Contrato assinado"
        anexos={contrato.anexos}
        storageKey={`mobirelli-arquivo-contrato-${contratoId}`}
        onChange={(anexos) => setContrato({ ...contrato, anexos })}
      />

      <button
        onClick={() =>
          onSave({
            clienteId,
            novoCliente,
            contrato: { ...contrato, id: contratoId, valorMensal: Number(contrato.valorMensal) || 0 },
          })
        }
        className="w-full rounded-xl py-2 font-semibold mt-1"
        style={{ background: theme.mint, color: theme.text, fontWeight: 600 }}
      >
        {editando ? "Salvar contrato" : "Confirmar aluguel"}
      </button>
    </Modal>
  );
}

function emptyManutencao() {
  return { id: uid(), data: todayISO(), tipo: "", valorGasto: "", local: "", garantia: false };
}

function emptyCustoExtra() {
  return { id: uid(), data: todayISO(), descricao: "", valorGasto: "" };
}

function CustoExtraModal({ onClose, onSave }) {
  const [form, setForm] = useState(emptyCustoExtra());
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <Modal title="Novo custo da moto" onClose={onClose}>
      <FieldLabel>Data</FieldLabel>
      <input type="date" style={dateInputStyle} value={form.data} onChange={set("data")} />
      <FieldLabel>Descrição</FieldLabel>
      <input style={inputStyle} value={form.descricao} onChange={set("descricao")} placeholder="Despachante, documentação, comissão..." />
      <FieldLabel>Valor gasto</FieldLabel>
      <input type="number" step="0.01" style={inputStyle} value={form.valorGasto} onChange={set("valorGasto")} />
      <button
        onClick={() => onSave({ ...form, valorGasto: Number(form.valorGasto) || 0 })}
        className="w-full rounded-xl py-2 font-semibold mt-1"
        style={{ background: theme.mint, color: theme.text, fontWeight: 600 }}
      >
        Salvar
      </button>
    </Modal>
  );
}

function ManutencaoModal({ onClose, onSave }) {
  const [form, setForm] = useState(emptyManutencao());
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <Modal title="Nova manutenção" onClose={onClose}>
      <FieldLabel>Data</FieldLabel>
      <input type="date" style={dateInputStyle} value={form.data} onChange={set("data")} />
      <FieldLabel>Tipo de manutenção</FieldLabel>
      <input style={inputStyle} value={form.tipo} onChange={set("tipo")} placeholder="Troca de óleo, pneu..." />
      <Row2>
        <div>
          <FieldLabel>Valor gasto</FieldLabel>
          <input type="number" step="0.01" style={inputStyle} value={form.valorGasto} onChange={set("valorGasto")} />
        </div>
        <div>
          <FieldLabel>Local</FieldLabel>
          <input style={inputStyle} value={form.local} onChange={set("local")} />
        </div>
      </Row2>
      <label className="flex items-center gap-2 mb-3 text-sm" style={{ color: theme.text, fontFamily: BODY_FONT }}>
        <input type="checkbox" checked={form.garantia} onChange={(e) => setForm({ ...form, garantia: e.target.checked })} />
        Coberto por garantia
      </label>
      <button
        onClick={() => onSave({ ...form, valorGasto: Number(form.valorGasto) || 0 })}
        className="w-full rounded-xl py-2 font-semibold mt-1"
        style={{ background: theme.mint, color: theme.text, fontWeight: 600 }}
      >
        Salvar
      </button>
    </Modal>
  );
}

function ConsultaPlacaModal({ onClose }) {
  const [placa, setPlaca] = useState("");
  const [status, setStatus] = useState("idle"); // idle | carregando | ok | erro
  const [resultado, setResultado] = useState(null);
  const [erro, setErro] = useState("");

  const consultar = async () => {
    if (!placa.trim() || status === "carregando") return;
    setStatus("carregando");
    setErro("");
    try {
      const res = await fetch(`/api/consulta-placa?placa=${encodeURIComponent(placa)}`);
      const data = await res.json();
      if (!res.ok || data.erro) {
        setErro(data.erro || "Não foi possível consultar essa placa agora.");
        setStatus("erro");
        return;
      }
      setResultado(data);
      setStatus("ok");
    } catch {
      setErro("Falha de conexão. Tente de novo.");
      setStatus("erro");
    }
  };

  const dados = resultado?.dados || resultado?.data || resultado || {};
  const pegar = (...chaves) => chaves.map((c) => dados[c]).find((v) => v != null && v !== "");

  const Campo = ({ label, valor }) =>
    valor ? (
      <div className="flex justify-between text-sm py-1.5" style={{ borderBottom: `1px solid ${theme.divider}` }}>
        <span style={{ color: theme.textMuted }}>{label}</span>
        <span style={{ color: theme.text, fontWeight: 600, textAlign: "right" }}>{String(valor)}</span>
      </div>
    ) : null;

  return (
    <Modal title="Consulta de placa" onClose={onClose}>
      <FieldLabel>Placa</FieldLabel>
      <div className="flex gap-2 mb-1">
        <input
          style={{ ...inputStyle, marginBottom: 0, textTransform: "uppercase" }}
          value={placa}
          onChange={(e) => setPlaca(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && consultar()}
          placeholder="ABC1D23"
          maxLength={8}
        />
        <button
          onClick={consultar}
          disabled={status === "carregando"}
          className="rounded-xl px-4 font-semibold text-sm"
          style={{ background: theme.mint, color: theme.text, fontWeight: 600, opacity: status === "carregando" ? 0.6 : 1 }}
        >
          Consultar
        </button>
      </div>
      <div className="text-xs mb-3" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
        Dados públicos de veículos (marca, modelo, ano, cor). Não substitui uma consulta oficial no Detran.
      </div>

      {status === "carregando" && (
        <div className="text-sm" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
          Consultando...
        </div>
      )}

      {status === "erro" && (
        <div className="rounded-xl p-3 text-sm" style={{ background: `${theme.coral}1F`, color: theme.coral, fontFamily: BODY_FONT }}>
          {erro}
        </div>
      )}

      {status === "ok" && (
        <div className="rounded-xl p-3" style={{ background: theme.card2, fontFamily: BODY_FONT }}>
          <Campo label="Marca" valor={pegar("marca", "MARCA", "brand")} />
          <Campo label="Modelo" valor={pegar("modelo", "MODELO", "model")} />
          <Campo label="Ano fabricação" valor={pegar("ano", "anoFabricacao", "ANO", "year")} />
          <Campo label="Ano modelo" valor={pegar("anoModelo", "ANO_MODELO", "modelYear")} />
          <Campo label="Cor" valor={pegar("cor", "COR", "color")} />
          <Campo label="Chassi" valor={pegar("chassi", "CHASSI", "chassis")} />
          <Campo label="Município" valor={pegar("municipio", "MUNICIPIO", "city")} />
          <Campo label="UF" valor={pegar("uf", "UF", "state")} />
          <Campo label="Situação" valor={pegar("situacao", "SITUACAO", "status")} />
        </div>
      )}
    </Modal>
  );
}

function MotosView({ motos, persist, clientes, persistClientes, config, lancamentos, persistLancamentos }) {
  const [busca, setBusca] = useState("");
  const [expandido, setExpandido] = useState(null);
  const [verCadastro, setVerCadastro] = useState(null);
  const [modal, setModal] = useState(null);
  const [preview, setPreview] = useState(null);

  const salvarMoto = async (moto) => {
    const existe = motos.find((m) => m.id === moto.id);
    const next = existe ? motos.map((m) => (m.id === moto.id ? moto : m)) : [...motos, moto];
    await persist(next);
    setModal(null);
  };

  // trava: nunca deixa excluir uma moto alugada (o botão já não aparece nesse caso, isso
  // aqui é só uma segunda garantia). Se a moto já teve lançamentos de caixa vinculados a
  // ela (histórico de recebimentos, custos, manutenções), avisa antes — eles continuam
  // contando no Faturamento/Lucro normalmente, só perdem a etiqueta de "qual moto era"
  const excluirMoto = async (id) => {
    const moto = motos.find((m) => m.id === id);
    if (moto?.status === "alugada") return;
    const qtdVinculados = (lancamentos || []).filter((l) => l.motoId === id).length;
    if (qtdVinculados > 0) {
      const plural = qtdVinculados === 1 ? "lançamento" : "lançamentos";
      const ok = window.confirm(
        `Essa moto tem ${qtdVinculados} ${plural} de caixa vinculado${qtdVinculados === 1 ? "" : "s"} a ela (recebimentos, custos ou manutenções). Eles vão continuar contando no Faturamento e no Lucro normalmente, só que sem saber de qual moto eram. Quer excluir a moto mesmo assim?`
      );
      if (!ok) return;
    }
    await persist(motos.filter((m) => m.id !== id));
  };

  const confirmarContrato = async (moto, dados) => {
    let clienteId = dados.clienteId;
    if (clienteId === "novo") {
      await persistClientes([...clientes, dados.novoCliente]);
      clienteId = dados.novoCliente.id;
    }
    const atualizado = {
      ...moto,
      status: "alugada",
      contratoAtual: { ...dados.contrato, clienteId },
    };
    await salvarMoto(atualizado);
    setModal(null);
  };

  const atualizarContrato = async (moto, dados) => {
    await salvarMoto({ ...moto, contratoAtual: { ...moto.contratoAtual, ...dados.contrato } });
    setModal(null);
  };

  const encerrarContrato = async (moto) => {
    if (!moto.contratoAtual) return;
    const encerrado = { ...moto.contratoAtual, encerradoEm: todayISO() };
    await salvarMoto({
      ...moto,
      status: "disponivel",
      contratoAtual: null,
      historicoContratos: [...(moto.historicoContratos || []), encerrado],
    });
  };

  // manutenção/custo cadastrados aqui na moto viram um lançamento de saída no Caixa
  // (com motoId apontando pra essa moto), em vez de ficar só guardado dentro da moto —
  // é o mesmo lugar que "custosDaMoto"/"manutencoesDaMoto" já leem pro lado "vindo do
  // Caixa". Sem isso, o gasto não aparecia no faturamento/lucro do mês nem no "Retorno
  // do investimento por moto", porque esses cálculos só olham pra lista de lançamentos,
  // nunca pra dentro de moto.manutencoes/custosExtras
  const salvarManutencao = async (moto, manutencao) => {
    const descricaoPartes = [manutencao.tipo || "Manutenção"];
    if (manutencao.local) descricaoPartes.push(manutencao.local);
    if (manutencao.garantia) descricaoPartes.push("coberto por garantia");
    const lancamento = {
      id: manutencao.id,
      data: manutencao.data,
      tipo: "saida",
      natureza: "Manutenção",
      categoria: manutencao.tipo || "Manutenção",
      valor: manutencao.valorGasto,
      descricao: descricaoPartes.join(" — "),
      forma: "",
      motoId: moto.id,
      parcelas: 1,
    };
    await persistLancamentos([...(lancamentos || []), lancamento]);
    setModal(null);
  };

  // "Lançar pagamento" na moto atrasada: cria a entrada no Caixa já vinculada à moto
  // (motoId), que é justamente o que faz ela sair de "pagamento atrasado". Antes o único
  // caminho era ir na aba Caixa e lembrar de escolher a moto na mão — sem isso o app não
  // liga o dinheiro a ninguém e a moto fica vermelha com o pagamento já lançado.
  const registrarPagamento = async (moto) => {
    const valor = Number(moto.contratoAtual?.valorMensal) || 0;
    if (!window.confirm(`Lançar ${formatCurrency(valor)} recebidos de ${formatPlaca(moto.placa)} hoje?`)) return;
    const lancamento = {
      id: uid(),
      data: todayISO(),
      tipo: "entrada",
      natureza: "Operacional",
      categoria: `Mensalidade ${formatPlaca(moto.placa)}`,
      valor,
      descricao: "",
      forma: "",
      motoId: moto.id,
      parcelas: 1,
    };
    await persistLancamentos([...(lancamentos || []), lancamento]);
  };

  // reclassifica um gasto que já está no Caixa como manutenção — lançamentos antigos,
  // feitos antes do campo "Moto dessa manutenção" existir, ficaram com a natureza padrão
  // e por isso apareciam em "Custos" em vez de "Manutenções"
  const marcarComoManutencao = async (id) => {
    await persistLancamentos((lancamentos || []).map((l) => (l.id === id ? { ...l, natureza: "Manutenção" } : l)));
  };

  const salvarCustoExtra = async (moto, custo) => {
    const lancamento = {
      id: custo.id,
      data: custo.data,
      tipo: "saida",
      natureza: "Operacional",
      categoria: custo.descricao || "Custo da moto",
      valor: custo.valorGasto,
      descricao: custo.descricao || "",
      forma: "",
      motoId: moto.id,
      parcelas: 1,
    };
    await persistLancamentos([...(lancamentos || []), lancamento]);
    setModal(null);
  };

  // apaga um item de manutenção/custo — se ele ainda vive dentro da moto (registros
  // antigos, de antes dessa integração com o Caixa), tira de lá; senão é um lançamento
  // de verdade no Caixa, tira de lá
  const excluirManutencao = async (moto, id) => {
    const naMoto = (moto.manutencoes || []).some((m) => m.id === id);
    if (naMoto) {
      await salvarMoto({ ...moto, manutencoes: moto.manutencoes.filter((m) => m.id !== id) });
    } else {
      await persistLancamentos((lancamentos || []).filter((l) => l.id !== id));
    }
  };

  const excluirCustoExtra = async (moto, id) => {
    const naMoto = (moto.custosExtras || []).some((c) => c.id === id);
    if (naMoto) {
      await salvarMoto({ ...moto, custosExtras: moto.custosExtras.filter((c) => c.id !== id) });
    } else {
      await persistLancamentos((lancamentos || []).filter((l) => l.id !== id));
    }
  };

  const filtradas = motos.filter((m) => {
    const q = busca.toLowerCase();
    const qLimpo = placaLimpa(busca).toLowerCase();
    return (
      !q ||
      [m.placa, m.chassi, m.renavam, m.modelo].some((f) => f?.toLowerCase().includes(q)) ||
      (qLimpo && m.placa?.toLowerCase().includes(qLimpo))
    );
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <h2 style={{ fontFamily: HEAD_FONT, fontSize: 22, fontWeight: 700, color: theme.mint }}>Motos</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setModal({ type: "consulta" })}
            className="flex items-center gap-1 rounded-xl px-3 py-2 text-sm font-semibold"
            style={{ border: `1px solid ${theme.outline}`, color: theme.outlineText }}
          >
            <Search size={15} /> Consultar placa
          </button>
          {permissoes.podeEditar && (
            <button
              onClick={() => setModal({ type: "moto", mode: "novo", moto: emptyMoto() })}
              className="flex items-center gap-1 rounded-xl px-3 py-2 text-sm font-semibold"
              style={{ background: theme.mint, color: theme.text, fontWeight: 600 }}
            >
              <Plus size={16} /> Nova moto
            </button>
          )}
        </div>
      </div>

      <div className="relative mb-4">
        <Search size={15} style={{ position: "absolute", left: 10, top: 10, color: theme.textMuted }} />
        <input
          style={{ ...inputStyle, paddingLeft: 32, marginBottom: 0 }}
          placeholder="Buscar por placa, chassi, renavam ou modelo"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
      </div>

      {filtradas.length === 0 && (
        <div className="rounded-2xl p-6 text-center" style={{ background: theme.card, color: theme.textMuted, fontFamily: BODY_FONT }}>
          Nenhuma moto encontrada.
        </div>
      )}

      <div className="flex flex-col gap-2">
        {filtradas.map((moto) => {
          const pagamentos = pagamentosDaMoto(moto, lancamentos);
          const vencido = moto.status === "alugada" && isContratoVencido(moto.contratoAtual, pagamentos);
          const mesAtualKey = todayISO().slice(0, 7);
          const cobraEsteMes = moto.contratoAtual ? contratoCobraNoMes(moto.contratoAtual, mesAtualKey) : false;
          const pagoEsteMes = cobraEsteMes && pagouNoMes(pagamentos, mesAtualKey);
          const cliente = clientes.find((c) => c.id === moto.contratoAtual?.clienteId);
          const aberto = expandido === moto.id;
          return (
            <div key={moto.id} className="rounded-2xl overflow-hidden" style={{ background: theme.card, border: `1px solid ${theme.cardBorder}` }}>
              <button className="w-full flex items-center gap-3 justify-between px-4 py-3 text-left" onClick={() => setExpandido(aberto ? null : moto.id)}>
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="flex items-center justify-center flex-shrink-0"
                    style={{ width: 28, height: 28, borderRadius: 8, background: theme.card2 }}
                  >
                    <Bike size={16} color={vencido ? theme.coral : moto.status === "alugada" ? theme.mint : theme.textGhost} />
                  </div>
                  <div className="flex flex-col gap-3 min-w-0">
                    <MotoPlate placa={moto.placa} />
                    <StatusBadge status={moto.status} />
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {vencido && <AlertTriangle size={14} color={theme.coral} />}
                  {aberto ? <ChevronUp size={18} color={theme.textMuted} /> : <ChevronDown size={18} color={theme.textMuted} />}
                </div>
              </button>

              <Collapse open={aberto}>
                <div className="px-4 pb-4 text-sm" style={{ fontFamily: BODY_FONT }}>
                  <div style={{ fontFamily: HEAD_FONT, fontSize: 16, color: theme.text }} className="mb-5">
                    {moto.modelo || "Modelo não informado"}
                  </div>

                  <div className="mb-5">
                    <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: theme.textFaint }}>
                      Contrato
                    </div>
                    {moto.contratoAtual ? (
                      <div className="rounded-xl p-3" style={{ background: theme.card2 }}>
                        {vencido && (
                          <div className="mb-2">
                            <div className="flex items-center gap-1.5" style={{ color: theme.coral, fontSize: 12, fontWeight: 600 }}>
                              <AlertTriangle size={13} /> Pagamento atrasado
                              {diaVencimentoDoContrato(moto.contratoAtual) && ` — venceu dia ${diaVencimentoDoContrato(moto.contratoAtual)} e não tem pagamento lançado no caixa`}
                            </div>
                            {permissoes.podeEditar && (
                              <button
                                onClick={() => registrarPagamento(moto)}
                                className="text-xs font-semibold rounded-xl px-3 py-1.5 mt-2 flex items-center gap-1"
                                style={{ border: `1px solid ${theme.outline}`, color: theme.outlineText }}
                              >
                                <CheckCircle2 size={12} /> Lançar pagamento recebido
                              </button>
                            )}
                          </div>
                        )}
                        {/* o contrário do atraso, pra fechar o ciclo: lançou no caixa, a moto
                            mostra na hora que o mês está quitado */}
                        {pagoEsteMes && (
                          <div className="flex items-center gap-1.5 mb-2" style={{ color: theme.mint, fontSize: 12, fontWeight: 600 }}>
                            <CheckCircle2 size={13} /> Pagamento deste mês já lançado
                          </div>
                        )}
                        {/* aluguel é pago no fim do período: quem alugou agora só paga no mês
                            que vem. Sem isso a moto parecia cobrável no mês da assinatura */}
                        {moto.status === "alugada" && !cobraEsteMes && primeiraCobrancaDoContrato(moto.contratoAtual) && (
                          <div className="flex items-center gap-1.5 mb-2" style={{ color: theme.amber, fontSize: 12, fontWeight: 600 }}>
                            1ª cobrança em {monthLabel(primeiraCobrancaDoContrato(moto.contratoAtual).slice(0, 7))}
                          </div>
                        )}
                        <div className="flex items-center justify-between mb-1">
                          <span style={{ color: theme.text, fontWeight: 600 }}>{cliente?.nome || "Cliente"}</span>
                          <span style={{ color: theme.amber, fontFamily: HEAD_FONT, fontSize: 17 }}>
                            {formatCurrency(moto.contratoAtual.valorMensal)}/mês
                          </span>
                        </div>
                        <div style={{ color: theme.textMuted, fontSize: 12 }}>
                          {moto.contratoAtual.numeroClienteMoto}º cliente · contrato nº {moto.contratoAtual.numeroContrato}
                          {moto.contratoAtual.dataInicio && ` · alugou em ${formatDate(moto.contratoAtual.dataInicio)}`}
                          {diaVencimentoDoContrato(moto.contratoAtual) && ` · pagamento todo dia ${diaVencimentoDoContrato(moto.contratoAtual)}`}
                          {moto.contratoAtual.dataTermino && ` · até ${formatDate(moto.contratoAtual.dataTermino)}`}
                        </div>
                        {contratoAnexosOf(moto.contratoAtual).length > 0 && (
                          <div className="flex items-center gap-3 mt-1 flex-wrap">
                            <ContratoAnexosButton
                              anexos={contratoAnexosOf(moto.contratoAtual)}
                              tituloPreview={`Contrato — ${formatPlaca(moto.placa)}`}
                              onAbrir={(url, title) => setPreview({ url, title })}
                            />
                          </div>
                        )}
                        {permissoes.podeEditar && (
                          <div className="flex gap-2 mt-2">
                            <button
                              onClick={() => setModal({ type: "contrato", mode: "editar", moto })}
                              className="text-xs font-semibold rounded-xl px-3 py-1.5 flex items-center gap-1"
                              style={{ border: `1px solid ${theme.outline}`, color: theme.outlineText }}
                            >
                              <Pencil size={12} /> Editar contrato
                            </button>
                            <button
                              onClick={() => encerrarContrato(moto)}
                              className="text-xs font-semibold rounded-xl px-3 py-1.5"
                              style={{ border: `1px solid ${theme.outline}`, color: theme.outlineText }}
                            >
                              Encerrar contrato
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      permissoes.podeEditar && (
                        <button
                          onClick={() => setModal({ type: "contrato", moto })}
                          className="text-xs font-semibold rounded-xl px-3"
                          style={{ background: theme.mint, color: theme.text, minHeight: 44 }}
                        >
                          Alugar / novo contrato
                        </button>
                      )
                    )}
                  </div>

                  <div className="mb-5">
                    <MotoTrackingBlock link={moto.linkRastreamento || config?.linkRastreioGeral} placa={moto.placa} />
                  </div>

                  <div className="mb-5">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: theme.textFaint }}>
                        Manutenções
                      </span>
                      {permissoes.podeEditar && (
                        <button
                          onClick={() => setModal({ type: "manutencao", moto })}
                          className="flex items-center justify-center mbr-hover-grow"
                          style={{ color: theme.mint, width: 44, height: 44, marginRight: -10 }}
                        >
                          <Plus size={16} />
                        </button>
                      )}
                    </div>
                    {manutencoesDaMoto(moto, lancamentos).length === 0 ? (
                      <div style={{ color: theme.textMuted, fontSize: 12 }}>Nenhuma registrada.</div>
                    ) : (
                      [...manutencoesDaMoto(moto, lancamentos)].reverse().map((mnt) => (
                        <div key={mnt.id} className="flex items-center justify-between gap-2 text-xs py-1" style={{ borderTop: `1px solid ${theme.divider}` }}>
                          <span style={{ color: theme.text }}>
                            {formatDate(mnt.data)} · {mnt.descricao}
                          </span>
                          <span className="flex items-center gap-2 flex-shrink-0">
                            <span style={{ color: theme.textMuted }}>{formatCurrency(mnt.valorGasto)}</span>
                            {permissoes.podeEditar && (
                              <button
                                onClick={() => excluirManutencao(moto, mnt.id)}
                                className="flex items-center justify-center mbr-hover-grow"
                                style={{ color: theme.coral, width: 44, height: 44, margin: "-12px -10px -12px 0" }}
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </span>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="mb-5">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: theme.textFaint }}>
                        Custos
                      </span>
                      {permissoes.podeEditar && (
                        <button
                          onClick={() => setModal({ type: "custoExtra", moto })}
                          className="flex items-center justify-center mbr-hover-grow"
                          style={{ color: theme.mint, width: 44, height: 44, marginRight: -10 }}
                        >
                          <Plus size={16} />
                        </button>
                      )}
                    </div>
                    {custosDaMoto(moto, lancamentos).length === 0 ? (
                      <div style={{ color: theme.textMuted, fontSize: 12 }}>Nenhum registrado.</div>
                    ) : (
                      [...custosDaMoto(moto, lancamentos)].reverse().map((c) => (
                        <div key={c.id} className="flex items-center justify-between gap-2 text-xs py-1" style={{ borderTop: `1px solid ${theme.divider}` }}>
                          <span style={{ color: theme.text }}>
                            {formatDate(c.data)} · {c.descricao}
                          </span>
                          <span className="flex items-center gap-2 flex-shrink-0">
                            <span style={{ color: theme.textMuted }}>{formatCurrency(c.valorGasto)}</span>
                            {permissoes.podeEditar && c.doCaixa && (
                              <button
                                onClick={() => marcarComoManutencao(c.id)}
                                title="Mover pra Manutenções (muda a natureza do lançamento no caixa)"
                                className="text-xs font-semibold rounded-lg px-2 py-1"
                                style={{ border: `1px solid ${theme.outline}`, color: theme.outlineText, whiteSpace: "nowrap" }}
                              >
                                é manutenção
                              </button>
                            )}
                            {permissoes.podeEditar && (
                              <button
                                onClick={() => excluirCustoExtra(moto, c.id)}
                                className="flex items-center justify-center mbr-hover-grow"
                                style={{ color: theme.coral, width: 44, height: 44, margin: "-12px -10px -12px 0" }}
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </span>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="mb-5">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: theme.textFaint }}>
                        Pagamentos recebidos (fluxo de caixa)
                      </span>
                    </div>
                    {pagamentos.length === 0 ? (
                      <div style={{ color: theme.textMuted, fontSize: 12 }}>
                        Nenhum pagamento lançado pra essa moto ainda — lance no Caixa escolhendo a moto,
                        ou pelo botão de pagamento aqui em cima quando estiver atrasado.
                      </div>
                    ) : (
                      <>
                        <div className="flex justify-between text-xs mb-1" style={{ color: theme.mint, fontWeight: 700 }}>
                          <span>Total recebido</span>
                          <span>{formatCurrency(pagamentos.reduce((s, p) => s + Number(p.valor), 0))}</span>
                        </div>
                        {pagamentos.map((p) => (
                          <div key={p.id} className="flex items-center justify-between text-xs py-1" style={{ borderTop: `1px solid ${theme.divider}` }}>
                            <span style={{ color: theme.text }}>
                              {formatDate(p.data)} · {p.categoria || "Sem categoria"}
                            </span>
                            <span style={{ color: theme.textMuted }}>{formatCurrency(p.valor)}</span>
                          </div>
                        ))}
                      </>
                    )}
                  </div>

                  <div className="mb-5">
                    <button
                      onClick={() => setVerCadastro((v) => (v === moto.id ? null : moto.id))}
                      className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide"
                      style={{ color: theme.textFaint, minHeight: 32 }}
                    >
                      {verCadastro === moto.id ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                      Dados cadastrais e documentos
                    </button>
                    <Collapse open={verCadastro === moto.id}>
                      <div className="pt-3">
                        <div className="grid grid-cols-2 gap-x-3 gap-y-1 mb-3" style={{ color: theme.textMuted }}>
                          <span>Chassi: {moto.chassi || "—"}</span>
                          <span>Renavam: {moto.renavam || "—"}</span>
                          <span>Compra: {formatDate(moto.dataCompra)}</span>
                          <span>Valor: {formatCurrency(moto.valorCompra)}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {notaFiscalAnexosOf(moto).map((a, i, lista) => (
                            <button
                              key={`nf-${i}`}
                              onClick={() => setPreview({ url: a.link, title: `Nota fiscal — ${formatPlaca(moto.placa)}` })}
                              className="flex items-center justify-center gap-1.5 text-xs font-semibold rounded-xl px-2 text-center mbr-hover-grow"
                              style={{ background: theme.card2, color: theme.mint, minHeight: 44 }}
                            >
                              <FileText size={13} className="flex-shrink-0" /> {lista.length > 1 ? `Nota fiscal ${i + 1}` : "Nota fiscal"}
                            </button>
                          ))}
                          {notaFiscalFabricaAnexosOf(moto).map((a, i, lista) => (
                            <button
                              key={`nff-${i}`}
                              onClick={() => setPreview({ url: a.link, title: `Nota fiscal de fábrica — ${formatPlaca(moto.placa)}` })}
                              className="flex items-center justify-center gap-1.5 text-xs font-semibold rounded-xl px-2 text-center mbr-hover-grow"
                              style={{ background: theme.card2, color: theme.mint, minHeight: 44 }}
                            >
                              <FileText size={13} className="flex-shrink-0" /> {lista.length > 1 ? `NF de fábrica ${i + 1}` : "NF de fábrica"}
                            </button>
                          ))}
                          {moto.documentoLink && (
                            <button
                              onClick={() => setPreview({ url: moto.documentoLink, title: `Documento — ${formatPlaca(moto.placa)}` })}
                              className="flex items-center justify-center gap-1.5 text-xs font-semibold rounded-xl px-2 text-center mbr-hover-grow"
                              style={{ background: theme.card2, color: theme.mint, minHeight: 44 }}
                            >
                              <FileText size={13} className="flex-shrink-0" /> Documento
                            </button>
                          )}
                          {moto.certificadoLink && (
                            <button
                              onClick={() => setPreview({ url: moto.certificadoLink, title: `Certificado de garantia — ${formatPlaca(moto.placa)}` })}
                              className="flex items-center justify-center gap-1.5 text-xs font-semibold rounded-xl px-2 text-center mbr-hover-grow"
                              style={{ background: theme.card2, color: theme.mint, minHeight: 44 }}
                            >
                              <FileText size={13} className="flex-shrink-0" /> Certificado
                            </button>
                          )}
                        </div>
                      </div>
                    </Collapse>
                  </div>

                  {permissoes.podeEditar && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => setModal({ type: "moto", mode: "editar", moto })}
                        className="text-xs font-semibold rounded-xl px-3 py-1.5 flex items-center gap-1"
                        style={{ border: `1px solid ${theme.outline}`, color: theme.outlineText }}
                      >
                        <Pencil size={12} /> Editar
                      </button>
                      {moto.status !== "alugada" && (
                        <button
                          onClick={() => excluirMoto(moto.id)}
                          className="text-xs font-semibold rounded-xl px-3 py-1.5 flex items-center gap-1"
                          style={{ border: `1px solid ${theme.cardBorder}`, color: theme.coral }}
                        >
                          <Trash2 size={12} /> Excluir
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </Collapse>
            </div>
          );
        })}
      </div>

      {modal?.type === "moto" && (
        <MotoFormModal
          title={modal.mode === "novo" ? "Cadastrar moto" : "Editar moto"}
          moto={modal.moto}
          onClose={() => setModal(null)}
          onSave={salvarMoto}
        />
      )}
      {modal?.type === "contrato" && (
        <ContratoModal
          moto={modal.moto}
          clientes={clientes}
          editando={modal.mode === "editar"}
          onClose={() => setModal(null)}
          onSave={(dados) => (modal.mode === "editar" ? atualizarContrato(modal.moto, dados) : confirmarContrato(modal.moto, dados))}
        />
      )}
      {modal?.type === "manutencao" && (
        <ManutencaoModal onClose={() => setModal(null)} onSave={(m) => salvarManutencao(modal.moto, m)} />
      )}
      {modal?.type === "custoExtra" && (
        <CustoExtraModal onClose={() => setModal(null)} onSave={(c) => salvarCustoExtra(modal.moto, c)} />
      )}
      {modal?.type === "consulta" && <ConsultaPlacaModal onClose={() => setModal(null)} />}
      {preview && <PdfViewer url={preview.url} title={preview.title} onClose={() => setPreview(null)} />}
    </div>
  );
}

/* ===========================================================
   FLUXO DE CAIXA
=========================================================== */
const NATUREZAS = ["Operacional", "Administrativo", "Manutenção", "Expansão"];

function emptyLancamento() {
  return { id: uid(), data: todayISO(), tipo: "entrada", natureza: "Operacional", categoria: "", valor: "", descricao: "", forma: "", motoId: "", parcelas: 1 };
}

function LancamentoModal({ lancamento, onClose, onSave, onDelete, motos, editando }) {
  const [form, setForm] = useState({ motoId: "", parcelas: lancamento?.parcelasTotal || 1, ...lancamento });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const selecionarMoto = (id) => setForm((f) => ({ ...f, motoId: id }));
  const ehManutencao = form.natureza === "Manutenção";

  // o formulário só mostra Valor/Data/Natureza/Categoria de cara — "Moto relacionada",
  // "Forma de pagamento", "Parcelas" e "Descrição" ficam atrás de "Mais opções", já
  // abertas sozinhas se o lançamento (ao editar) já usa algum desses campos, pra não
  // esconder informação que a pessoa já tinha preenchido antes
  const [maisOpcoes, setMaisOpcoes] = useState(
    !!(form.motoId || form.forma || Number(form.parcelas) > 1 || form.descricao)
  );

  return (
    <Modal title={editando ? "Editar lançamento" : "Novo lançamento"} onClose={onClose}>
      <div className="flex gap-2 mb-3">
        {["entrada", "saida"].map((t) => (
          <button
            key={t}
            onClick={() => setForm({ ...form, tipo: t })}
            className="flex-1 rounded-xl py-2 text-sm font-semibold"
            style={{
              background: form.tipo === t ? (t === "entrada" ? theme.mint : theme.coral) : "transparent",
              color: form.tipo === t ? theme.mintText : theme.textMuted,
              border: `1px solid ${theme.cardBorder}`,
            }}
          >
            {t === "entrada" ? "Entrada" : "Saída"}
          </button>
        ))}
      </div>

      <FieldLabel>Natureza</FieldLabel>
      <SelectField value={form.natureza} onChange={set("natureza")} options={NATUREZAS.map((n) => ({ value: n, label: n }))} />

      {/* Dois casos em que a moto NÃO é detalhe opcional e por isso não fica escondida
          atrás de "Mais opções":
          - Manutenção: é a moto que faz o gasto aparecer na ficha dela, em "Manutenções"
            (era fácil salvar uma troca de óleo sem moto e depois não achar ela lá).
          - Entrada: é a moto que liga o pagamento ao aluguel. Sem ela o app não tem como
            saber de quem é o dinheiro, e a moto continuava marcada como "pagamento
            atrasado" mesmo com o pagamento já lançado no caixa. */}
      {(form.natureza === "Manutenção" || form.tipo === "entrada") && (motos || []).length > 0 && (
        <>
          <FieldLabel>{ehManutencao ? "Moto dessa manutenção" : "Moto desse pagamento"}</FieldLabel>
          <SelectField
            value={form.motoId || ""}
            onChange={(e) => selecionarMoto(e.target.value)}
            options={[
              { value: "", label: "Escolha a moto..." },
              ...motos.map((m) => ({ value: m.id, label: `${formatPlaca(m.placa)} — ${m.modelo || "modelo?"}` })),
            ]}
          />
          <div
            className="text-xs -mt-2 mb-3"
            style={{ color: form.motoId ? theme.textMuted : theme.amber, fontFamily: BODY_FONT }}
          >
            {ehManutencao
              ? form.motoId
                ? "Vai aparecer na ficha dessa moto, em Manutenções — além de entrar aqui no caixa."
                : "Escolha a moto pra essa manutenção aparecer na ficha dela. Sem moto, ela fica só no caixa."
              : form.motoId
                ? "Baixa o aluguel dessa moto no mês da data abaixo — ela sai de \"pagamento atrasado\" na aba Motos e na agenda de cobranças."
                : "Escolha a moto pra esse pagamento baixar o aluguel dela. Sem moto, ela continua marcada como \"pagamento atrasado\"."}
          </div>
        </>
      )}

      <FieldLabel>Categoria</FieldLabel>
      <input style={inputStyle} value={form.categoria} onChange={set("categoria")} placeholder="Mensalidade, manutenção, combustível..." />
      <Row2>
        <div>
          <FieldLabel>Valor (R$)</FieldLabel>
          <input type="number" step="0.01" style={inputStyle} value={form.valor} onChange={set("valor")} />
        </div>
        <div>
          <FieldLabel>Data</FieldLabel>
          <input type="date" style={dateInputStyle} value={form.data} onChange={set("data")} />
        </div>
      </Row2>

      {!maisOpcoes ? (
        <button
          type="button"
          onClick={() => setMaisOpcoes(true)}
          className="text-xs font-semibold mb-3"
          style={{ color: theme.mint, fontFamily: BODY_FONT }}
        >
          + Mais opções (moto, forma de pagamento, parcelas, detalhe extra)
        </button>
      ) : (
        <>
          {/* a moto já aparece lá em cima quando é manutenção ou entrada — aqui só pra
              saída comum (combustível, despachante...), onde ela é mesmo opcional */}
          {(motos || []).length > 0 && !ehManutencao && form.tipo !== "entrada" && (
            <>
              <FieldLabel>Moto relacionada (opcional)</FieldLabel>
              <SelectField
                value={form.motoId || ""}
                onChange={(e) => selecionarMoto(e.target.value)}
                options={[
                  { value: "", label: "Nenhuma / não é de uma moto específica" },
                  ...motos.map((m) => ({ value: m.id, label: `${formatPlaca(m.placa)} — ${m.modelo || "modelo?"}` })),
                ]}
              />
              <div className="text-xs -mt-2 mb-3" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
                Use pra mensalidade, manutenção, combustível, despachante — qualquer gasto ou receita de uma moto específica.
              </div>
            </>
          )}
          <FieldLabel>Forma de pagamento (opcional)</FieldLabel>
          <input style={inputStyle} value={form.forma} onChange={set("forma")} placeholder="Pix, boleto, cartão..." />
          <FieldLabel>Parcelas</FieldLabel>
          <input
            type="number"
            min="1"
            style={inputStyle}
            value={form.parcelas}
            onChange={(e) => setForm({ ...form, parcelas: Math.max(1, Number(e.target.value) || 1) })}
          />
          {Number(form.parcelas) > 1 && (
            <div className="text-xs -mt-2 mb-3" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
              {Number(form.parcelas) > (lancamento?.parcelasTotal || 1)
                ? `Esse lançamento entra como a 1ª parcela — as outras ${Number(form.parcelas) - (lancamento?.parcelasTotal || 1)} entram automaticamente em "Contas futuras", uma por mês.`
                : `Marcado como parcela 1 de ${Number(form.parcelas)}.`}
            </div>
          )}
          <FieldLabel>Detalhe extra (opcional)</FieldLabel>
          <input style={inputStyle} value={form.descricao} onChange={set("descricao")} placeholder="Alguma observação a mais, se precisar" />
        </>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => onSave({ ...form, valor: Number(form.valor) || 0 })}
          className="flex-1 rounded-xl py-2 font-semibold mt-1"
          style={{ background: theme.mint, color: theme.text, fontWeight: 600 }}
        >
          Salvar
        </button>
        {editando && (
          <button
            onClick={onDelete}
            className="rounded-xl py-2 px-4 font-semibold mt-1"
            style={{ border: `1px solid ${theme.cardBorder}`, color: theme.coral }}
          >
            Excluir
          </button>
        )}
      </div>
    </Modal>
  );
}

function emptyFuturo() {
  return {
    id: uid(),
    tipo: "saida",
    nome: "",        // o que aparece na lista e vira o título do lançamento
    categoria: "",   // classificação livre (opcional)
    descricao: "",   // detalhe extra (opcional)
    natureza: "Operacional",
    valor: "",
    vencimento: todayISO(),
    recorrente: false,
    pago: false,
    motoId: "",
    parcelas: 1,
  };
}

function FuturoModal({ futuro, onClose, onSave, onDelete, editando, motos }) {
  // conta antiga não tem "nome": o nome dela estava em "descricao". Ao abrir pra editar,
  // trazemos esse texto pro campo Nome (e esvaziamos o detalhe), senão a pessoa reabria a
  // conta e via o campo Nome em branco
  const ehAntiga = futuro && !futuro.nome && futuro.descricao;
  const [form, setForm] = useState({
    tipo: "saida",
    motoId: "",
    aplicarTodas: false,
    natureza: "Operacional",
    parcelas: futuro?.parcelasTotal || 1,
    ...futuro,
    nome: futuro?.nome || (ehAntiga ? futuro.descricao : ""),
    descricao: ehAntiga ? "" : futuro?.descricao || "",
  });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const isEntrada = form.tipo === "entrada";

  // uma escolha só, em vez de duas caixinhas soltas ("se repete todo mês" + "já foi
  // pago") que davam pra marcar juntas sem querer e não tinham como dizer "parcelado".
  //
  // O modo é ESTADO PRÓPRIO, não deduzido do número de parcelas. Quando era deduzido
  // (parcelas > 1 ? "parcelado" : "unica"), apagar o "2" pra digitar "48" zerava a
  // conta por um instante e a tela pulava sozinha de volta pra "Uma vez", levando o
  // campo junto — não dava pra digitar nenhum número de dois dígitos.
  const [modo, setModo] = useState(
    futuro?.recorrente ? "mensal" : Number(futuro?.parcelasTotal) > 1 ? "parcelado" : "unica"
  );
  const trocarModo = (novo) => {
    setModo(novo);
    setForm((f) => ({
      ...f,
      recorrente: novo === "mensal",
      parcelas: novo === "parcelado" ? (Number(f.parcelas) > 1 ? f.parcelas : 2) : 1,
      pago: novo === "unica" ? f.pago : false,
    }));
  };

  const nParcelas = Math.max(1, Number(form.parcelas) || 1);
  const valorNum = Number(form.valor) || 0;
  // uma parcela já existente não vira um novo carnê ao ser reaberta
  const jaEhParcela = Number(futuro?.parcelasTotal) > 1;

  // igual ao modal de lançamento: o formulário abre curto e o resto fica atrás de "Mais
  // opções" — já aberto se a conta que está sendo editada usa algum desses campos
  const [maisOpcoes, setMaisOpcoes] = useState(
    !!(form.motoId || form.categoria || form.descricao || (form.natureza && form.natureza !== "Operacional"))
  );

  const salvar = () => {
    const { aplicarTodas, parcelas, ...base } = form;
    const valor = valorNum;
    const nome = (base.nome || "").trim();
    const comNome = { ...base, nome, valor };

    // parcelado: gera uma conta por mês a partir do 1º vencimento, cada uma com o valor
    // da parcela e marcada "k/n" — assim cada parcela é confirmada no seu mês, e a
    // projeção dos próximos meses já conta com elas
    const gerarParcelas = (baseConta) => {
      const [ano, mes, dia] = (baseConta.vencimento || todayISO()).split("-").map(Number);
      const grupo = uid();
      return Array.from({ length: nParcelas }, (_, i) => {
        const d = new Date(ano, mes - 1 + i, dia);
        return {
          ...baseConta,
          id: i === 0 ? baseConta.id : uid(),
          vencimento: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
          recorrente: false,
          pago: false,
          parcelaAtual: i + 1,
          parcelasTotal: nParcelas,
          grupoParcelas: grupo,
        };
      });
    };

    const alvos =
      aplicarTodas && (motos || []).length > 0
        ? motos.map((m) => ({ ...comNome, id: uid(), motoId: m.id }))
        : [comNome];

    const deveParcelar = modo === "parcelado" && nParcelas > 1 && !jaEhParcela;
    onSave(deveParcelar ? alvos.flatMap(gerarParcelas) : alvos);
  };

  return (
    <Modal title={editando ? "Editar conta futura" : "Nova conta futura"} onClose={onClose}>
      <div className="flex gap-2 mb-3">
        {["saida", "entrada"].map((t) => (
          <button
            key={t}
            onClick={() => setForm({ ...form, tipo: t })}
            className="flex-1 rounded-xl py-2 text-sm font-semibold"
            style={{
              background: form.tipo === t ? (t === "entrada" ? theme.mint : theme.coral) : "transparent",
              color: form.tipo === t ? theme.mintText : theme.textMuted,
              border: `1px solid ${theme.cardBorder}`,
            }}
          >
            {t === "entrada" ? "Recebimento futuro" : "Conta a pagar"}
          </button>
        ))}
      </div>
      <FieldLabel>Nome</FieldLabel>
      <input
        style={inputStyle}
        value={form.nome}
        onChange={set("nome")}
        placeholder={isEntrada ? "De onde vem esse dinheiro" : "Quem você paga / o que é"}
      />
      <div className="text-xs -mt-2 mb-3" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
        É esse texto que aparece na lista e vira o nome do lançamento quando você confirmar.
      </div>

      <Row2>
        <div>
          <FieldLabel>{modo === "parcelado" ? "Valor da parcela (R$)" : "Valor (R$)"}</FieldLabel>
          <input type="number" step="0.01" style={inputStyle} value={form.valor} onChange={set("valor")} />
        </div>
        <div>
          <FieldLabel>{modo === "unica" ? "Vencimento" : "1º vencimento"}</FieldLabel>
          <input type="date" style={dateInputStyle} value={form.vencimento} onChange={set("vencimento")} />
        </div>
      </Row2>

      <FieldLabel>Como se repete</FieldLabel>
      <div className="flex gap-2 mb-3">
        {[
          { id: "unica", label: "Uma vez" },
          { id: "parcelado", label: "Parcelado" },
          { id: "mensal", label: "Todo mês" },
        ].map((op) => (
          <button
            key={op.id}
            type="button"
            onClick={() => trocarModo(op.id)}
            disabled={jaEhParcela && op.id !== modo}
            className="flex-1 rounded-xl py-2 text-sm font-semibold"
            style={{
              background: modo === op.id ? theme.mint : "transparent",
              color: modo === op.id ? theme.mintText : theme.textMuted,
              border: `1px solid ${theme.cardBorder}`,
              opacity: jaEhParcela && op.id !== modo ? 0.4 : 1,
            }}
          >
            {op.label}
          </button>
        ))}
      </div>

      {modo === "parcelado" && (
        <>
          <FieldLabel>Número de parcelas</FieldLabel>
          <input
            type="number"
            min="2"
            style={inputStyle}
            value={form.parcelas}
            onChange={(e) => setForm({ ...form, parcelas: e.target.value })}
            disabled={jaEhParcela}
          />
          <div className="text-xs -mt-2 mb-3" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
            {jaEhParcela
              ? `Essa é a parcela ${futuro.parcelaAtual || 1} de ${futuro.parcelasTotal} — pra mudar o parcelamento, apague as parcelas e cadastre de novo.`
              : `${nParcelas}x de ${formatCurrency(valorNum)} = ${formatCurrency(valorNum * nParcelas)} no total. Entra uma conta por mês a partir do 1º vencimento.`}
          </div>
        </>
      )}
      {modo === "mensal" && (
        <div className="text-xs -mt-1 mb-3" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
          Se repete pra sempre, todo mês no mesmo dia — você confirma mês a mês.
        </div>
      )}
      {modo === "unica" && (
        <label className="flex items-center gap-2 mb-3 text-sm" style={{ color: theme.text, fontFamily: BODY_FONT }}>
          <input type="checkbox" checked={form.pago} onChange={(e) => setForm({ ...form, pago: e.target.checked })} />
          {isEntrada ? "Já foi recebido" : "Já foi pago"}
        </label>
      )}

      {!maisOpcoes ? (
        <button
          type="button"
          onClick={() => setMaisOpcoes(true)}
          className="text-xs font-semibold mb-3"
          style={{ color: theme.mint, fontFamily: BODY_FONT }}
        >
          + Mais opções (natureza, moto, detalhe extra)
        </button>
      ) : (
        <>
          <FieldLabel>Natureza</FieldLabel>
          <SelectField value={form.natureza} onChange={set("natureza")} options={NATUREZAS.map((n) => ({ value: n, label: n }))} />
          <FieldLabel>Categoria (opcional)</FieldLabel>
          <input style={inputStyle} value={form.categoria} onChange={set("categoria")} placeholder="Pra agrupar contas parecidas" />
          {(motos || []).length > 0 && (
            <>
              <FieldLabel>Moto relacionada (opcional)</FieldLabel>
              <SelectField
                value={form.motoId || ""}
                onChange={(e) => setForm({ ...form, motoId: e.target.value })}
                options={[
                  { value: "", label: "Nenhuma / não é de uma moto específica" },
                  ...motos.map((m) => ({ value: m.id, label: `${formatPlaca(m.placa)} — ${m.modelo || "modelo?"}` })),
                ]}
              />
              {!editando && (
                <label className="flex items-center gap-2 mb-3 text-sm" style={{ color: theme.text, fontFamily: BODY_FONT }}>
                  <input
                    type="checkbox"
                    checked={form.aplicarTodas}
                    onChange={(e) => setForm({ ...form, aplicarTodas: e.target.checked })}
                  />
                  Aplicar a todas as motos ({motos.length}) — lança uma conta dessas pra cada moto
                </label>
              )}
            </>
          )}
          <FieldLabel>Detalhe extra (opcional)</FieldLabel>
          <input style={inputStyle} value={form.descricao} onChange={set("descricao")} placeholder="Alguma observação a mais, se precisar" />
        </>
      )}
      <div className="flex gap-2">
        <button
          onClick={salvar}
          className="flex-1 rounded-xl py-2 font-semibold mt-1"
          style={{ background: theme.mint, color: theme.text, fontWeight: 600 }}
        >
          Salvar
        </button>
        {editando && (
          <button
            onClick={onDelete}
            className="rounded-xl py-2 px-4 font-semibold mt-1"
            style={{ border: `1px solid ${theme.cardBorder}`, color: theme.coral }}
          >
            Excluir
          </button>
        )}
      </div>
    </Modal>
  );
}

const FuturosView = forwardRef(function FuturosView({ futuros, persist, motos, clientes, onConfirmar, mesAtualKey, lancamentos }, ref) {
  const [modal, setModal] = useState(null);
  const [verTodasCobrancas, setVerTodasCobrancas] = useState(false);
  const [verTodosFixos, setVerTodosFixos] = useState(false);
  const [verTodosAvulsos, setVerTodosAvulsos] = useState(false);
  const [verGrafico, setVerGrafico] = useState(false);
  const [grupoAberto, setGrupoAberto] = useState(null);
  // o botão "Nova conta futura" mora no cabeçalho compartilhado com "Lançado" (vira o
  // "Novo" de lá, ver FluxoCaixaView) — aqui só expõe um jeito de abrir o modal de fora
  useImperativeHandle(ref, () => ({ abrirNovo: () => setModal(emptyFuturo()) }));

  const salvar = async (fOrLista) => {
    const lista = Array.isArray(fOrLista) ? fOrLista : [fOrLista];
    let next = [...futuros];
    lista.forEach((f) => {
      const existe = next.find((x) => x.id === f.id);
      next = existe ? next.map((x) => (x.id === f.id ? f : x)) : [...next, f];
    });
    await persist(next);
    setModal(null);
  };
  const excluir = async (id) => persist(futuros.filter((x) => x.id !== id));

  const { fixoMensalSaida, fixoMensalEntrada, avulsosPendentesSaida, avulsosPendentesEntrada, previstoSaida12Meses, previstoEntrada12Meses, saldoPrevisto12Meses } =
    totaisFuturos(futuros, motos);
  const contratos = contratosComoFuturos(motos);
  const projecao = projecaoFuturosPorMes([...futuros, ...contratos], 12);

  const recorrentes = futuros.filter((f) => f.recorrente);
  // avulso confirmado (pago) já virou um lançamento real em "Lançado" — some daqui, não
  // faz sentido continuar mostrando como pendência
  const avulsos = [...futuros.filter((f) => !f.recorrente && !f.pago)].sort((a, b) => (a.vencimento > b.vencimento ? 1 : -1));

  // agenda de cobrança: agrupa por dia do mês quem tem que ser cobrado — pensado pra
  // quando tiver muitas motos/clientes e ficar difícil lembrar "quem vence quando" só
  // olhando a lista corrida de contratos/recorrentes
  // A agenda responde "quem eu cobro ESTE mês?". Um contrato fechado neste mês ainda não
  // entra: o aluguel é pago no fim do período, então a 1ª cobrança dele é no mês que vem.
  // Por isso a lista é separada em dois blocos — antes tudo aparecia junto e só dava pra
  // saber de quem cobrar indo olhar a data de início contrato por contrato.
  const cobrancas = (() => {
    const hojeISO = todayISO();
    const mesHoje = hojeISO.slice(0, 7);
    const diaHoje = Number(hojeISO.slice(8, 10));
    const recorrentes = [...contratos, ...futuros.filter((f) => f.recorrente && f.tipo === "entrada")];
    const agora = [];
    const depois = [];
    recorrentes.forEach((f) => {
      const dia = f.diaVencimento || (f.vencimento ? Number(f.vencimento.slice(8, 10)) : null);
      if (!dia) return;
      const moto = motos?.find((m) => m.id === f.motoId);
      const cliente = moto?.contratoAtual ? clientes?.find((c) => c.id === moto.contratoAtual.clienteId) : null;
      const mesDaPrimeira = (f.vencimento || "").slice(0, 7);
      const jaComecou = !mesDaPrimeira || mesDaPrimeira <= mesAtualKey;
      // estado de cada cobrança, lido de onde o dinheiro realmente entra: pra contrato é
      // o pagamento lançado no Caixa pra essa moto (mesmo caminho da aba Motos, então as
      // duas telas nunca se contradizem); pra conta recorrente comum é o "confirmados"
      // dela. Antes a agenda era só uma lista de dias, sem saber quem já pagou.
      const recebido = jaComecou
        ? moto
          ? pagouNoMes(pagamentosDaMoto(moto, lancamentos), mesAtualKey)
          : (f.confirmados || []).includes(mesAtualKey)
        : false;
      const atrasado = jaComecou && !recebido && mesAtualKey === mesHoje && dia < diaHoje;
      const item = {
        id: f.id,
        dia,
        label: cliente?.nome || nomeDoFuturo(f),
        sub: moto ? formatPlaca(moto.placa) : null,
        valor: Number(f.valor) || 0,
        desde: f.dataInicioContrato || "",
        mesDaPrimeira,
        recebido,
        atrasado,
      };
      (jaComecou ? agora : depois).push(item);
    });
    const porDia = (lista) => lista.sort((a, b) => a.dia - b.dia);
    // o que está atrasado sobe, o que já entrou desce — é essa a ordem em que a pessoa
    // precisa olhar a lista, não a ordem do calendário
    const peso = (it) => (it.atrasado ? 0 : it.recebido ? 2 : 1);
    return {
      agora: porDia(agora).sort((a, b) => peso(a) - peso(b)),
      depois: porDia(depois),
      aReceber: agora.filter((it) => !it.recebido).reduce((t, it) => t + it.valor, 0),
      recebido: agora.filter((it) => it.recebido).reduce((t, it) => t + it.valor, 0),
      atrasadas: agora.filter((it) => it.atrasado).length,
    };
  })();

  // Junta numa linha só o que é "a mesma conta repetida", pra lista não virar um
  // paredão: as parcelas de um mesmo carnê (um financiamento em 48x virava 48 linhas)
  // e a mesma conta aplicada a várias motos (rastreador, seguro — vira uma conta por
  // moto no banco). Clicar na linha abre e mostra o que tem dentro.
  //
  // Contas já cadastradas não têm o campo de grupo, então o agrupamento por moto usa o
  // CONTEÚDO (nome + tipo + valor + dia) como chave — assim o que já está no banco
  // aparece agrupado sem precisar recadastrar nada.
  const agrupar = (lista) => {
    const grupos = new Map();
    lista.forEach((f) => {
      const dia = f.diaVencimento || (f.vencimento ? f.vencimento.slice(8, 10) : "");
      const chave = f.grupoParcelas
        ? `parc:${f.grupoParcelas}`
        : f.motoId
        ? `moto:${nomeDoFuturo(f)}|${f.tipo}|${Number(f.valor) || 0}|${f.recorrente ? 1 : 0}|${dia}`
        : `uni:${f.id}`;
      if (!grupos.has(chave)) grupos.set(chave, { chave, itens: [] });
      grupos.get(chave).itens.push(f);
    });
    return [...grupos.values()];
  };

  const gruposFixos = agrupar(recorrentes);
  const gruposAvulsos = agrupar(avulsos);

  const GrupoRow = ({ grupo }) => {
    const itens = grupo.itens;
    const primeiro = itens[0];
    const aberto = grupoAberto === grupo.chave;
    const ehParcelado = grupo.chave.startsWith("parc:");
    const total = itens.reduce((s, f) => s + (Number(f.valor) || 0), 0);
    const pendentes = itens.filter((f) => !f.pago);
    const proxima = [...pendentes].sort((a, b) => (a.vencimento > b.vencimento ? 1 : -1))[0];
    const totalParcelas = primeiro.parcelasTotal || itens.length;

    return (
      <div className="rounded-2xl overflow-hidden" style={{ background: theme.card, border: `1px solid ${theme.cardBorder}` }}>
        <div
          onClick={() => setGrupoAberto(aberto ? null : grupo.chave)}
          className="flex items-center justify-between px-4 py-3 cursor-pointer"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center justify-center flex-shrink-0" style={{ width: 28, height: 28, borderRadius: 8, background: theme.card2 }}>
              {primeiro.tipo === "entrada" ? <TrendingUp size={16} color={theme.mint} /> : <TrendingDown size={16} color={theme.coral} />}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span style={{ color: theme.text, fontFamily: BODY_FONT, fontWeight: 600 }}>{nomeDoFuturo(primeiro)}</span>
                <span
                  style={{ fontSize: 10.5, fontWeight: 700, borderRadius: 999, padding: "1px 8px", background: theme.card2, color: theme.textMuted, flexShrink: 0 }}
                >
                  {ehParcelado ? `${totalParcelas} parcelas` : `${itens.length} motos`}
                </span>
              </div>
              <div style={{ color: theme.textMuted, fontFamily: BODY_FONT, fontSize: 12 }}>
                {ehParcelado
                  ? `${formatCurrency(primeiro.valor)} por mês · faltam ${pendentes.length} de ${totalParcelas}${
                      proxima ? ` · próxima em ${formatDate(proxima.vencimento)}` : ""
                    }`
                  : primeiro.recorrente
                  ? `Todo mês · dia ${primeiro.diaVencimento || (primeiro.vencimento ? new Date(`${primeiro.vencimento}T00:00:00`).getDate() : "?")} · ${formatCurrency(primeiro.valor)} por moto`
                  : `Vence em ${formatDate(primeiro.vencimento)} · ${formatCurrency(primeiro.valor)} por moto`}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span style={{ color: primeiro.tipo === "entrada" ? theme.mint : theme.coral, fontFamily: HEAD_FONT, fontSize: 16 }}>
              {primeiro.tipo === "entrada" ? "+" : "-"} {formatCurrency(ehParcelado ? total : total)}
            </span>
            {aberto ? <ChevronUp size={16} color={theme.textMuted} /> : <ChevronDown size={16} color={theme.textMuted} />}
          </div>
        </div>
        <Collapse open={aberto}>
          <div className="flex flex-col gap-2 px-3 pb-3">
            {itens.map((f) => (
              <FuturoRow key={f.id} f={f} dentroDeGrupo />
            ))}
          </div>
        </Collapse>
      </div>
    );
  };

  const FuturoRow = ({ f, dentroDeGrupo }) => {
    const motoLigada = motos?.find((m) => m.id === f.motoId);
    const diaDoMes = f.diaVencimento || (f.vencimento ? new Date(`${f.vencimento}T00:00:00`).getDate() : null);
    // fixa mensal não tem "pago" (ela se repete pra sempre) — o que existe é confirmar ou
    // não o mês atual específico; avulso pago já nem chega aqui (filtrado antes da lista)
    const jaConfirmadoEsteMes = f.recorrente && (f.confirmados || []).includes(mesAtualKey);
    return (
    <div
      key={f.id}
      onClick={() => permissoes.podeEditar && setModal(f)}
      className={`flex items-center justify-between px-4 py-3 rounded-2xl${permissoes.podeEditar ? " cursor-pointer" : ""}`}
      style={{
        background: dentroDeGrupo ? theme.card2 : theme.card,
        border: `1px solid ${dentroDeGrupo ? "transparent" : theme.cardBorder}`,
        opacity: jaConfirmadoEsteMes ? 0.55 : 1,
      }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div
          className="flex items-center justify-center flex-shrink-0"
          style={{ width: 28, height: 28, borderRadius: 8, background: theme.card2 }}
        >
          {f.tipo === "entrada" ? <TrendingUp size={16} color={theme.mint} /> : <TrendingDown size={16} color={theme.coral} />}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span style={{ color: theme.text, fontFamily: BODY_FONT, fontWeight: 600 }}>{nomeDoFuturo(f)}</span>
            {f.parcelasTotal > 1 && (
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  borderRadius: 999,
                  padding: "1px 8px",
                  background: theme.card2,
                  color: theme.textMuted,
                  flexShrink: 0,
                }}
              >
                Parcela {f.parcelaAtual || 1}/{f.parcelasTotal}
              </span>
            )}
          </div>
          <div style={{ color: theme.textMuted, fontFamily: BODY_FONT, fontSize: 12 }}>
            {f.recorrente ? `Todo mês · dia ${diaDoMes}` : `Vence em ${formatDate(f.vencimento)}`}
            {jaConfirmadoEsteMes && " · mês atual já lançado"}
            {motoLigada && ` · ${formatPlaca(motoLigada.placa)}`}
            {detalheDoFuturo(f) && ` · ${detalheDoFuturo(f)}`}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <span style={{ color: f.tipo === "entrada" ? theme.mint : theme.coral, fontFamily: HEAD_FONT, fontSize: 16 }}>
          {f.tipo === "entrada" ? "+" : "-"} {formatCurrency(f.valor)}
        </span>
        {permissoes.podeEditar && !jaConfirmadoEsteMes && onConfirmar && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onConfirmar(f, f.recorrente ? mesAtualKey : undefined);
            }}
            title={f.tipo === "entrada" ? "Confirmar recebimento" : "Confirmar pagamento"}
            className="mbr-hover-grow flex items-center justify-center"
            style={{ color: theme.mint, width: 30, height: 30 }}
          >
            <CheckCircle2 size={16} />
          </button>
        )}
        {permissoes.podeEditar && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              excluir(f.id);
            }}
            className="mbr-hover-grow flex items-center justify-center"
            style={{ color: theme.textMuted, width: 30, height: 30, marginRight: -6 }}
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
    );
  };

  return (
    <div>
      {(cobrancas.agora.length > 0 || cobrancas.depois.length > 0) && (
        <div className="rounded-2xl p-4 mb-4" style={{ background: theme.card, border: `1px solid ${theme.cardBorder}` }}>
          <h3 style={{ fontFamily: HEAD_FONT, fontSize: 16, color: theme.text }} className="mb-1">
            Agenda de cobranças
          </h3>
          <div className="text-xs mb-3" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
            Quem você cobra em {monthLabel(mesAtualKey)}
            {cobrancas.aReceber > 0 && (
              <>
                {" · falta entrar "}
                <span style={{ color: theme.text, fontWeight: 700 }}>{formatCurrency(cobrancas.aReceber)}</span>
              </>
            )}
            {cobrancas.atrasadas > 0 && (
              <span style={{ color: theme.coral, fontWeight: 700 }}>
                {` · ${cobrancas.atrasadas} atrasad${cobrancas.atrasadas === 1 ? "a" : "as"}`}
              </span>
            )}
          </div>

          {cobrancas.agora.length === 0 ? (
            <div className="text-xs" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
              Nenhuma cobrança neste mês.
            </div>
          ) : (
            <div className="flex flex-col">
              {(verTodasCobrancas ? cobrancas.agora : cobrancas.agora.slice(0, 5)).map((it, i) => (
                <div
                  key={it.id}
                  className="flex items-center gap-3 py-2.5"
                  style={{ borderTop: i === 0 ? "none" : `1px solid ${theme.divider}`, opacity: it.recebido ? 0.55 : 1 }}
                >
                  <div
                    className="flex-shrink-0 flex items-center justify-center rounded-lg"
                    style={{
                      width: 38,
                      height: 38,
                      background: theme.card2,
                      color: it.recebido ? theme.mint : it.atrasado ? theme.coral : theme.text,
                      fontFamily: HEAD_FONT,
                      fontWeight: 700,
                      fontSize: 13,
                    }}
                  >
                    {String(it.dia).padStart(2, "0")}
                  </div>
                  <div className="flex-1 min-w-0" style={{ fontFamily: BODY_FONT }}>
                    <div className="truncate text-xs" style={{ color: theme.text }}>{it.label}</div>
                    {/* o estado vem do Caixa: lançou o pagamento da moto, a linha muda aqui */}
                    <div className="text-xs" style={{ color: it.recebido ? theme.mint : it.atrasado ? theme.coral : theme.textMuted }}>
                      {it.sub || ""}
                      {it.recebido ? `${it.sub ? " · " : ""}já recebido` : it.atrasado ? `${it.sub ? " · " : ""}atrasado` : ""}
                    </div>
                  </div>
                  <span
                    className="text-xs flex-shrink-0"
                    style={{ color: it.atrasado ? theme.coral : theme.mint, fontWeight: 700, fontFamily: BODY_FONT }}
                  >
                    {formatCurrency(it.valor)}
                  </span>
                </div>
              ))}
            </div>
          )}
          {cobrancas.agora.length > 5 && (
            <button
              onClick={() => setVerTodasCobrancas((v) => !v)}
              className="text-xs font-semibold mt-2"
              style={{ color: theme.mint, fontFamily: BODY_FONT, minHeight: 32 }}
            >
              {verTodasCobrancas ? "Ver menos" : `Ver mais (${cobrancas.agora.length - 5})`}
            </button>
          )}

          {/* contratos fechados neste mês: a 1ª cobrança cai só no mês seguinte. Aqui o
              mês aparece de propósito, porque é justamente a informação que faltava —
              junto com a data em que o cliente alugou, que não existia em lugar nenhum */}
          {cobrancas.depois.length > 0 && (
            <div className="mt-4 pt-3" style={{ borderTop: `1px solid ${theme.divider}` }}>
              <div className="text-xs uppercase tracking-wide mb-2" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
                Ainda não cobra
              </div>
              <div className="flex flex-col">
                {cobrancas.depois.map((it, i) => (
                  <div
                    key={it.id}
                    className="flex items-center gap-3 py-2.5"
                    style={{ borderTop: i === 0 ? "none" : `1px solid ${theme.divider}` }}
                  >
                    <div
                      className="flex-shrink-0 flex items-center justify-center rounded-lg"
                      style={{ width: 38, height: 38, background: theme.card2, color: theme.amber, fontFamily: HEAD_FONT, fontWeight: 700, fontSize: 13 }}
                    >
                      {String(it.dia).padStart(2, "0")}
                    </div>
                    <div className="flex-1 min-w-0" style={{ fontFamily: BODY_FONT }}>
                      <div className="truncate text-xs" style={{ color: theme.text }}>{it.label}</div>
                      <div className="text-xs" style={{ color: theme.textMuted }}>
                        {it.sub ? `${it.sub} · ` : ""}
                        {it.desde ? `alugou em ${formatDate(it.desde)}` : "sem data de início"}
                      </div>
                      <div className="text-xs" style={{ color: theme.amber }}>
                        1ª cobrança em {monthLabel(it.mesDaPrimeira)}
                      </div>
                    </div>
                    <span className="text-xs flex-shrink-0" style={{ color: theme.textMuted, fontWeight: 700, fontFamily: BODY_FONT }}>
                      {formatCurrency(it.valor)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* os três números do ano em UM cartão, em vez de três cartões com duas linhas de
          jargão cada ("fixo/mês", "avulso") — a aba abria com quatro blocos de resumo
          antes de mostrar qualquer conta, e era isso que fazia ela parecer cheia demais */}
      <div className="rounded-2xl p-4 mb-4" style={{ background: theme.card, border: `1px solid ${theme.cardBorder}` }}>
        <div className="text-xs uppercase tracking-wide mb-3" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
          Próximos 12 meses
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <div className="text-xs mb-0.5" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>A receber</div>
            <div style={{ fontFamily: HEAD_FONT, fontSize: 18, color: theme.mint }}>{formatCurrency(previstoEntrada12Meses)}</div>
          </div>
          <div>
            <div className="text-xs mb-0.5" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>A pagar</div>
            <div style={{ fontFamily: HEAD_FONT, fontSize: 18, color: theme.coral }}>{formatCurrency(previstoSaida12Meses)}</div>
          </div>
          <div>
            <div className="text-xs mb-0.5" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>Sobra prevista</div>
            <div style={{ fontFamily: HEAD_FONT, fontSize: 18, color: saldoPrevisto12Meses >= 0 ? theme.mint : theme.coral }}>
              {formatCurrency(saldoPrevisto12Meses)}
            </div>
          </div>
        </div>
      </div>

      {recorrentes.length > 0 && (
        <div className="mb-4">
          <div className="text-xs uppercase tracking-wide mb-2" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
            Todo mês
          </div>
          <div className="flex flex-col gap-2">
            {(verTodosFixos ? gruposFixos : gruposFixos.slice(0, 4)).map((g) =>
              g.itens.length === 1 ? <FuturoRow key={g.chave} f={g.itens[0]} /> : <GrupoRow key={g.chave} grupo={g} />
            )}
          </div>
          {gruposFixos.length > 4 && (
            <button
              onClick={() => setVerTodosFixos((v) => !v)}
              className="text-xs font-semibold mt-2"
              style={{ color: theme.mint, fontFamily: BODY_FONT, minHeight: 32 }}
            >
              {verTodosFixos ? "Ver menos" : `Ver mais (${gruposFixos.length - 4})`}
            </button>
          )}
        </div>
      )}

      <div>
        <div className="text-xs uppercase tracking-wide mb-2" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
          Parcelamentos
        </div>
        {gruposAvulsos.length === 0 ? (
          <div className="rounded-2xl p-6 text-center" style={{ background: theme.card, color: theme.textMuted, fontFamily: BODY_FONT, border: `1px solid ${theme.cardBorder}` }}>
            Nenhum parcelamento ou conta com data marcada.
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              {(verTodosAvulsos ? gruposAvulsos : gruposAvulsos.slice(0, 4)).map((g) =>
                g.itens.length === 1 ? <FuturoRow key={g.chave} f={g.itens[0]} /> : <GrupoRow key={g.chave} grupo={g} />
              )}
            </div>
            {gruposAvulsos.length > 4 && (
              <button
                onClick={() => setVerTodosAvulsos((v) => !v)}
                className="text-xs font-semibold mt-2"
                style={{ color: theme.mint, fontFamily: BODY_FONT, minHeight: 32 }}
              >
                {verTodosAvulsos ? "Ver menos" : `Ver mais (${gruposAvulsos.length - 4})`}
              </button>
            )}
          </>
        )}
      </div>

      {/* o gráfico é consulta, não rotina: ocupava 280px no meio do caminho entre a
          agenda e as contas. Fica no fim, fechado, e abre quando a pessoa quiser */}
      <div className="rounded-2xl p-4 mb-4" style={{ background: theme.card, border: `1px solid ${theme.cardBorder}` }}>
        <button
          onClick={() => setVerGrafico((v) => !v)}
          className="w-full flex items-center justify-between"
          style={{ minHeight: 32 }}
        >
          <h3 style={{ fontFamily: HEAD_FONT, fontSize: 16, color: theme.text }}>Previsão por mês</h3>
          {verGrafico ? <ChevronUp size={18} color={theme.textMuted} /> : <ChevronDown size={18} color={theme.textMuted} />}
        </button>
        <Collapse open={verGrafico}>
          <div className="pt-3">
            {futuros.length === 0 ? (
              <div className="text-xs" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
                Cadastre uma conta futura pra ver a previsão aqui.
              </div>
            ) : (
              <div style={{ width: "100%", height: 280 }}>
                <ResponsiveContainer>
                  <ComposedChart data={projecao} margin={{ left: -12 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={theme.cardBorder} vertical={false} />
                    <XAxis dataKey="mes" stroke={theme.textMuted} fontSize={11} axisLine={false} tickLine={false} />
                    <YAxis stroke={theme.textMuted} fontSize={11} tickFormatter={formatCompact} width={56} axisLine={false} tickLine={false} />
                    <Tooltip content={<TooltipSemDuplicata formatter={(value, name) => [formatCurrency(value), name]} />} />
                    <Legend />
                    <Bar dataKey="entrada" name="A receber" fill={theme.mint} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="saida" name="A pagar" fill={theme.coral} radius={[4, 4, 0, 0]} />
                    <Line
                      type="monotone"
                      dataKey="saldo"
                      name="Saldo"
                      stroke={theme.amber}
                      strokeWidth={2.5}
                      dot={{ r: 3, fill: theme.amber, strokeWidth: 0 }}
                      activeDot={{ r: 5 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="saldo"
                      stroke={mixColors(theme.amber, "#FFFFFF", 0.65)}
                      strokeOpacity={0.55}
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                      legendType="none"
                      className="mbr-linha-cometa"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </Collapse>
      </div>

      {modal && (
        <FuturoModal
          futuro={modal}
          motos={motos}
          editando={futuros.some((x) => x.id === modal.id)}
          onClose={() => setModal(null)}
          onSave={salvar}
          onDelete={() => {
            excluir(modal.id);
            setModal(null);
          }}
        />
      )}
    </div>
  );
});

function FluxoCaixaView({ lancamentos, persist, motos, clientes, futuros, persistFuturos }) {
  const [modal, setModal] = useState(null);

  const salvar = async (l) => {
    const { parcelas, ...base } = l;
    const existe = lancamentos.find((x) => x.id === base.id);
    const parcelasAntes = existe?.parcelasTotal || 1;
    const parcelasNovo = Number(parcelas) || 1;

    // guarda quantas parcelas foram usadas direto no lançamento, pra mostrar "Parcela
    // 1/3" na lista e continuar aparecendo do jeito certo se abrir pra editar de novo
    const lancamento =
      parcelasNovo > 1 ? { ...base, parcelaAtual: existe?.parcelaAtual || 1, parcelasTotal: parcelasNovo } : { ...base, parcelaAtual: undefined, parcelasTotal: undefined };

    let futurosAtualizados = futuros || [];
    let futurosMudaram = false;

    // compra parcelada — a 1ª parcela é o lançamento de hoje, as demais entram como
    // contas futuras avulsas, uma por mês. Só gera as que ainda não existem: se a pessoa
    // só reabriu e salvou de novo sem mudar o número de parcelas, não duplica nada; se
    // aumentar o número depois, gera só a diferença
    if (parcelasNovo > parcelasAntes) {
      const [ano, mes, dia] = lancamento.data.split("-").map(Number);
      const novasParcelas = [];
      for (let k = parcelasAntes + 1; k <= parcelasNovo; k++) {
        const d = new Date(ano, mes - 1 + (k - 1), dia);
        novasParcelas.push({
          id: uid(),
          tipo: lancamento.tipo,
          // o "(k/n)" não entra no nome: quem mostra isso é a etiqueta "Parcela k/n"
          nome: lancamento.categoria || lancamento.descricao || "Parcela",
          categoria: lancamento.categoria,
          natureza: lancamento.natureza || "Operacional",
          descricao: "",
          valor: lancamento.valor,
          vencimento: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
          recorrente: false,
          pago: false,
          motoId: lancamento.motoId || "",
          parcelaAtual: k,
          parcelasTotal: parcelasNovo,
        });
      }
      futurosAtualizados = [...futurosAtualizados, ...novasParcelas];
      futurosMudaram = true;
    }

    // 1º lançamento de um mês novo — puxa automaticamente pra "Lançado" as parcelas de
    // compras já em andamento que vencem nesse mesmo mês (ex: parcela 4/12 de uma moto
    // financiada), em vez de ficar esperando em "Futuros" pra copiar na mão todo mês
    const mesDoNovo = lancamento.data?.slice(0, 7);
    const primeiroDoMes = !existe && mesDoNovo && !lancamentos.some((x) => x.data?.slice(0, 7) === mesDoNovo);
    const promovidos = [];
    if (primeiroDoMes) {
      futurosAtualizados = futurosAtualizados.filter((f) => {
        const elegivel = !f.recorrente && !f.pago && f.parcelasTotal > 1 && f.vencimento?.slice(0, 7) === mesDoNovo;
        if (!elegivel) return true;
        promovidos.push({
          id: uid(),
          tipo: f.tipo,
          data: f.vencimento,
          natureza: f.natureza || "Operacional",
          categoria: nomeDoFuturo(f),
          descricao: detalheDoFuturo(f),
          forma: "",
          motoId: f.motoId || "",
          parcelaAtual: f.parcelaAtual,
          parcelasTotal: f.parcelasTotal,
        });
        return false;
      });
      if (promovidos.length > 0) futurosMudaram = true;
    }

    const next = existe ? lancamentos.map((x) => (x.id === lancamento.id ? lancamento : x)) : [...lancamentos, lancamento, ...promovidos];
    await persist(next);
    if (futurosMudaram) await persistFuturos(futurosAtualizados);
    setModal(null);
  };

  const excluir = async (id) => persist(lancamentos.filter((x) => x.id !== id));
  const ordenados = [...lancamentos].sort((a, b) => (a.data < b.data ? 1 : -1));

  const porMes = {};
  ordenados.forEach((l) => {
    const key = l.data ? l.data.slice(0, 7) : "sem-data";
    (porMes[key] = porMes[key] || []).push(l);
  });

  // contas futuras (avulsas ou fixas mensais) ainda não confirmadas "penduram" dentro do
  // mês de Lançado a que pertencem — inclusive criando a abinha do mês sozinhas, antes de
  // qualquer lançamento real existir nele, pra não ficar escondido só na aba Futuros
  const mesAtualKey = todayISO().slice(0, 7);
  const mesesCandidatosPendencia = new Set(
    [
      mesAtualKey,
      ...Object.keys(porMes),
      ...(futuros || []).filter((f) => !f.recorrente && !f.pago && f.vencimento).map((f) => f.vencimento.slice(0, 7)),
      // nada DEPOIS do mês corrente: uma conta parcelada em 48x criava aba de mês até
      // 2030 aqui dentro. Parcela que ainda vai vencer é assunto da aba Futuros; em
      // "Lançado" ela só aparece quando o mês dela chegar
    ].filter((k) => k !== "sem-data" && k <= mesAtualKey)
  );
  const pendenciasPorMes = {};
  mesesCandidatosPendencia.forEach((mesKey) => {
    const pend = (futuros || [])
      .filter((f) => futuroPendenteNoMes(f, mesKey))
      // a conta futura entra na lista de "Lançado" com a mesma forma de um lançamento,
      // e lá o título da linha é "categoria" — então mandamos o NOME da conta nesse
      // campo, senão a linha aparecia com a classificação no lugar do nome
      .map((f) => ({
        ...f,
        id: `pend:${f.id}:${mesKey}`,
        _futuroId: f.id,
        _mesKey: mesKey,
        _pendente: true,
        categoria: nomeDoFuturo(f),
        descricao: detalheDoFuturo(f),
        data: dataDoFuturoNoMes(f, mesKey),
      }));
    if (pend.length > 0) pendenciasPorMes[mesKey] = pend;
  });

  const mesesComLancamentos = Object.keys(porMes).sort((a, b) => (a < b ? 1 : -1));
  const mesesOrdenados = [...new Set([...mesesComLancamentos, ...Object.keys(pendenciasPorMes)])].sort((a, b) => (a < b ? 1 : -1));

  // confirma que uma conta futura (avulsa ou a parcela do mês de uma fixa) realmente
  // aconteceu — gera o lançamento real em "Lançado" e marca a conta futura como resolvida
  // (avulsa some da lista de pendências; fixa mensal só marca ESSE mês como confirmado,
  // continua valendo pros meses seguintes)
  const confirmarFuturo = async (f, mesKeyParam) => {
    const original = (futuros || []).find((x) => x.id === (f._futuroId || f.id)) || f;
    const mesKey = mesKeyParam || f._mesKey || (original.vencimento || mesAtualKey).slice(0, 7);
    const novoLancamento = {
      id: uid(),
      tipo: original.tipo,
      data: dataDoFuturoNoMes(original, mesKey),
      natureza: original.natureza || "Operacional",
      // o lançamento herda o NOME da conta futura (na aba Lançado é "categoria" que
      // aparece como título da linha). Antes vinha a categoria aqui, então uma conta
      // chamada "X" com categoria "Seguro" virava um lançamento chamado "Seguro"
      categoria: nomeDoFuturo(original),
      valor: Number(original.valor) || 0,
      descricao: detalheDoFuturo(original),
      forma: "",
      motoId: original.motoId || "",
      parcelaAtual: original.parcelasTotal > 1 ? original.parcelaAtual : undefined,
      parcelasTotal: original.parcelasTotal > 1 ? original.parcelasTotal : undefined,
    };
    await persist([...lancamentos, novoLancamento]);
    const futurosAtualizados = (futuros || []).map((x) =>
      x.id === original.id
        ? original.recorrente
          ? { ...x, confirmados: [...(x.confirmados || []), mesKey] }
          : { ...x, pago: true }
        : x
    );
    await persistFuturos(futurosAtualizados);
    setDetalheAberto(null);
  };

  // Abre no mês CORRENTE (ou no mês mais recente que tenha lançamento de verdade).
  // Antes abria em mesesOrdenados[0], que é o mês mais DISTANTE da lista — bastava uma
  // conta parcelada em 48x pra tela abrir em 2030, num mês vazio, parecendo que os
  // lançamentos tinham sumido.
  const mesInicial =
    mesesOrdenados.find((m) => m === mesAtualKey) ||
    mesesComLancamentos.find((m) => m <= mesAtualKey) ||
    mesesOrdenados[0] ||
    null;
  const [expandido, setExpandido] = useState(mesInicial);
  const [detalheAberto, setDetalheAberto] = useState(null);
  const [grupoLancAberto, setGrupoLancAberto] = useState(null);

  // Uma linha de lançamento. Virou componente pra poder aparecer tanto solta quanto
  // dentro de um grupo de lançamentos de mesmo nome (ex.: o rastreador lançado pra 11
  // motos no mesmo mês, que antes eram 11 linhas iguais seguidas).
  const LinhaLancamento = ({ l, ultimo }) => {
                    const motoLigada = motos?.find((m) => m.id === l.motoId);
                    const detalheEsteAberto = detalheAberto === l.id;
                    const temDetalhe = !!(l.natureza || l.forma || l.descricao);
                    const pendente = !!l._pendente;
                    const corItem = pendente ? theme.amber : l.tipo === "entrada" ? theme.mint : theme.coral;
                    return (
                      <div
                        key={l.id}
                        style={{
                          background: pendente ? `${theme.amber}14` : theme.card2,
                          borderBottom: ultimo ? "none" : `1px solid ${theme.divider}`,
                        }}
                      >
                        <div
                          onClick={() => setDetalheAberto(detalheEsteAberto ? null : l.id)}
                          className="flex items-center justify-between px-4 py-3 cursor-pointer"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div
                              className="flex items-center justify-center flex-shrink-0"
                              style={{ width: 28, height: 28, borderRadius: 8, background: theme.card2 }}
                            >
                              {pendente ? (
                                <Clock size={16} color={theme.amber} />
                              ) : l.tipo === "entrada" ? (
                                <TrendingUp size={16} color={theme.mint} />
                              ) : (
                                <TrendingDown size={16} color={theme.coral} />
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span style={{ color: theme.text, fontFamily: BODY_FONT, fontWeight: 600 }}>{l.categoria || "Sem categoria"}</span>
                                {l.parcelasTotal > 1 && (
                                  <span
                                    className="text-xs font-semibold rounded-full px-2"
                                    style={{ background: theme.card, color: theme.textMuted, fontFamily: BODY_FONT }}
                                  >
                                    Parcela {l.parcelaAtual || 1}/{l.parcelasTotal}
                                  </span>
                                )}
                                {pendente && (
                                  <span
                                    className="text-xs font-semibold rounded-full px-2"
                                    style={{ background: `${theme.amber}26`, color: theme.amber, fontFamily: BODY_FONT }}
                                  >
                                    Previsto
                                  </span>
                                )}
                              </div>
                              <div style={{ color: theme.textFaint, fontFamily: BODY_FONT, fontSize: 12 }}>
                                {formatDate(l.data)}
                                {motoLigada && ` · ${formatPlaca(motoLigada.placa)}`}
                                {pendente && l.recorrente && " · fixo mensal"}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <span style={{ color: corItem, fontFamily: HEAD_FONT, fontWeight: 700, fontSize: 16 }}>
                              {l.tipo === "entrada" ? "+" : "-"} {formatCurrency(l.valor)}
                            </span>
                            {(temDetalhe || pendente || permissoes.podeEditar) &&
                              (detalheEsteAberto ? <ChevronUp size={16} color={theme.textMuted} /> : <ChevronDown size={16} color={theme.textMuted} />)}
                            {!pendente && permissoes.podeEditar && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  excluir(l.id);
                                }}
                                className="mbr-hover-grow flex items-center justify-center"
                                style={{ color: theme.textMuted, width: 36, height: 36, marginRight: -8 }}
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                        {pendente ? (
                          <Collapse open={detalheEsteAberto}>
                            <div className="px-4 pb-3 flex flex-col gap-2" style={{ borderTop: `1px solid ${theme.divider}`, paddingTop: 10 }}>
                              <div className="text-xs" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
                                Ainda não {l.tipo === "entrada" ? "recebido" : "pago"} — essa conta está cadastrada em
                                "Futuros" e ainda não virou um lançamento real.
                              </div>
                              {permissoes.podeEditar && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    confirmarFuturo(l);
                                  }}
                                  className="flex items-center justify-center gap-1.5 rounded-xl py-2 font-semibold text-sm"
                                  style={{ background: theme.mint, color: theme.mintText }}
                                >
                                  <CheckCircle2 size={14} /> Confirmar {l.tipo === "entrada" ? "recebimento" : "pagamento"}
                                </button>
                              )}
                            </div>
                          </Collapse>
                        ) : (
                        <Collapse open={detalheEsteAberto}>
                          <div className="px-4 pb-3 flex flex-col gap-1.5" style={{ borderTop: `1px solid ${theme.divider}`, paddingTop: 10 }}>
                            {l.natureza && (
                              <div className="flex items-center justify-between text-xs" style={{ fontFamily: BODY_FONT }}>
                                <span style={{ color: theme.textFaint }}>Natureza</span>
                                <span style={{ color: theme.textMuted }}>{l.natureza}</span>
                              </div>
                            )}
                            {l.forma && (
                              <div className="flex items-center justify-between text-xs" style={{ fontFamily: BODY_FONT }}>
                                <span style={{ color: theme.textFaint }}>Forma de pagamento</span>
                                <span style={{ color: theme.textMuted }}>{l.forma}</span>
                              </div>
                            )}
                            {l.descricao && (
                              <div className="flex items-center justify-between gap-3 text-xs" style={{ fontFamily: BODY_FONT }}>
                                <span style={{ color: theme.textFaint, flexShrink: 0 }}>Detalhe</span>
                                <span style={{ color: theme.textMuted, textAlign: "right" }}>{l.descricao}</span>
                              </div>
                            )}
                            {permissoes.podeEditar && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setModal(l);
                                }}
                                className="text-xs font-semibold flex items-center gap-1 mt-1"
                                style={{ color: theme.mint, fontFamily: BODY_FONT, minHeight: 32 }}
                              >
                                <Pencil size={12} /> Editar
                              </button>
                            )}
                          </div>
                        </Collapse>
                        )}
                      </div>
                    );
  };

  // agrupa, DENTRO do mês, os lançamentos que têm o mesmo nome (e mesmo tipo) — nada de
  // agrupar por mês ou ano, só nome igual com nome igual
  const agruparLancamentos = (lista) => {
    const grupos = new Map();
    lista.forEach((l) => {
      const chave = `${(l.categoria || "").trim().toLowerCase()}|${l.tipo}|${l._pendente ? 1 : 0}`;
      if (!grupos.has(chave)) grupos.set(chave, { chave, itens: [] });
      grupos.get(chave).itens.push(l);
    });
    return [...grupos.values()];
  };

  const GrupoLancamentos = ({ grupo, ultimo }) => {
    const itens = grupo.itens;
    const primeiro = itens[0];
    const aberto = grupoLancAberto === grupo.chave;
    const total = itens.reduce((s, l) => s + (Number(l.valor) || 0), 0);
    const pendente = !!primeiro._pendente;
    const cor = pendente ? theme.amber : primeiro.tipo === "entrada" ? theme.mint : theme.coral;
    return (
      <div style={{ borderBottom: ultimo ? "none" : `1px solid ${theme.divider}`, background: pendente ? theme.card2 : "transparent" }}>
        <div
          onClick={() => setGrupoLancAberto(aberto ? null : grupo.chave)}
          className="flex items-center justify-between cursor-pointer"
          style={{ padding: "13px 18px" }}
        >
          <div className="flex items-center min-w-0" style={{ gap: 12 }}>
            <div className="flex items-center justify-center flex-shrink-0" style={{ width: 30, height: 30, borderRadius: 9, background: theme.card2 }}>
              {primeiro.tipo === "entrada" ? <TrendingUp size={15} color={theme.mint} /> : <TrendingDown size={15} color={theme.coral} />}
            </div>
            <div className="min-w-0">
              <div className="flex items-center flex-wrap" style={{ gap: 6 }}>
                <span style={{ color: theme.text, fontWeight: 600, fontSize: 13.5 }}>{primeiro.categoria || "Sem categoria"}</span>
                <span style={{ fontSize: 10.5, fontWeight: 700, borderRadius: 999, padding: "1px 8px", background: theme.card2, color: theme.textMuted }}>
                  {itens.length}x
                </span>
              </div>
              <div style={{ color: theme.textMuted, fontSize: 11.5 }}>
                {/* mostra as placas no resumo: sem isso, três trocas de óleo de motos
                    diferentes viravam uma linha só e dava a impressão de terem sumido */}
                {(() => {
                  const placas = itens
                    .map((x) => motos?.find((m) => m.id === x.motoId))
                    .filter(Boolean)
                    .map((m) => formatPlaca(m.placa));
                  return placas.length > 0
                    ? placas.join(" · ")
                    : `${itens.length} lançamentos iguais neste mês`;
                })()}
              </div>
            </div>
          </div>
          <div className="flex items-center flex-shrink-0" style={{ gap: 4 }}>
            <span style={{ color: cor, fontWeight: 700, fontSize: 15 }}>
              {primeiro.tipo === "entrada" ? "+ " : "\u2212 "}
              {formatCurrency(total)}
            </span>
            {aberto ? <ChevronUp size={16} color={theme.textMuted} /> : <ChevronDown size={16} color={theme.textMuted} />}
          </div>
        </div>
        <Collapse open={aberto}>
          <div style={{ borderTop: `1px solid ${theme.divider}` }}>
            {itens.map((l, i) => (
              <LinhaLancamento key={l.id} l={l} ultimo={i === itens.length - 1} />
            ))}
          </div>
        </Collapse>
      </div>
    );
  };

  const [verTodosResumo, setVerTodosResumo] = useState(false);
  const [view, setView] = useState("lancado");
  const futurosViewRef = useRef(null);

  const viewToggleRef = useRef(null);
  const viewSlotRefs = useRef({});
  const [viewPillRect, setViewPillRect] = useState(null);

  // mesma pílula deslizante do menu de baixo, só que aqui entre "Lançado"/"Futuros" —
  // mede a posição do botão ativo e anima a faixa verde até ali em vez de simplesmente
  // trocar o fundo do botão na hora
  useEffect(() => {
    const medir = () => {
      const slot = viewSlotRefs.current[view];
      const container = viewToggleRef.current;
      if (!slot || !container) return;
      const slotRect = slot.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      setViewPillRect({ left: slotRect.left - containerRect.left, top: slotRect.top - containerRect.top, width: slotRect.width, height: slotRect.height });
    };
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, [view]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <h2 style={{ fontFamily: HEAD_FONT, fontSize: 22, fontWeight: 700, color: theme.mint }}>Fluxo de caixa</h2>
        <div className="flex items-center gap-2">
          <div ref={viewToggleRef} className="relative flex rounded-xl p-1" style={{ background: theme.card, border: `1px solid ${theme.cardBorder}` }}>
            {viewPillRect && (
              <span
                className="absolute rounded-lg"
                style={{
                  left: 0,
                  top: viewPillRect.top,
                  width: viewPillRect.width,
                  height: viewPillRect.height,
                  background: theme.mint,
                  willChange: "transform",
                  transform: `translateX(${viewPillRect.left}px)`,
                  transition: "transform 0.28s cubic-bezier(0.32, 0.72, 0, 1)",
                }}
              />
            )}
            {[
              { id: "lancado", label: "Lançado" },
              { id: "futuros", label: "Futuros" },
            ].map((v) => (
              <button
                key={v.id}
                ref={(el) => (viewSlotRefs.current[v.id] = el)}
                onClick={() => setView(v.id)}
                className="relative rounded-lg px-3 py-1.5 text-sm font-semibold"
                style={{
                  color: view === v.id ? theme.mintText : theme.textMuted,
                  transition: "color 0.15s ease",
                  zIndex: 1,
                }}
              >
                {v.label}
              </button>
            ))}
          </div>
          {/* um botão só que "vira" o outro ao trocar de aba — mesmo elemento, o texto
              troca (num único span remontado, sem dois textos coexistindo) e a caixa
              cresce/encolhe pra caber, em vez de um botão sumir aqui e outro nascer
              solto em outro lugar da tela (era isso que ficava "esquisito") */}
          {permissoes.podeEditar && (
            <button
              onClick={() => (view === "lancado" ? setModal(emptyLancamento()) : futurosViewRef.current?.abrirNovo())}
              className="flex items-center gap-1 rounded-xl px-3 py-2 text-sm font-semibold overflow-hidden"
              style={{
                background: theme.mint,
                color: theme.mintText,
                whiteSpace: "nowrap",
                width: view === "lancado" ? 96 : 140,
                transition: "width 0.32s cubic-bezier(0.22, 1, 0.36, 1)",
              }}
            >
              <Plus size={16} style={{ flexShrink: 0 }} />
              <span key={view} className="mbr-rotulo-troca" style={{ display: "inline-block" }}>
                {view === "lancado" ? "Novo" : "Nova conta"}
              </span>
            </button>
          )}
        </div>
      </div>

      {view === "futuros" ? (
        <FuturosView
          ref={futurosViewRef}
          futuros={futuros || []}
          persist={persistFuturos}
          motos={motos}
          clientes={clientes}
          onConfirmar={confirmarFuturo}
          mesAtualKey={mesAtualKey}
          lancamentos={lancamentos}
        />
      ) : (
        <>
      {mesesOrdenados.length === 0 && (
        <div className="rounded-2xl p-6 text-center" style={{ background: theme.card, color: theme.textMuted, fontFamily: BODY_FONT, border: `1px solid ${theme.cardBorder}` }}>
          Nenhum lançamento ainda.
        </div>
      )}

      {ordenados.length > 0 && (
        <div
          className="rounded-2xl p-4 mb-3"
          style={{ background: `linear-gradient(150deg, ${theme.card} 0%, ${theme.card2} 130%)`, border: `1px solid ${theme.cardBorder}` }}
        >
          <SectionTitle className="mb-3">Resumo mensal</SectionTitle>
          <div className="flex flex-col gap-2">
            {(verTodosResumo ? mesesComLancamentos : mesesComLancamentos.slice(0, 1)).map((mesKey) => {
              const itensResumo = porMes[mesKey];
              const entradaResumo = itensResumo.filter((l) => l.tipo === "entrada").reduce((s, l) => s + Number(l.valor), 0);
              const saidaResumo = itensResumo.filter((l) => l.tipo === "saida").reduce((s, l) => s + Number(l.valor), 0);
              const saldoResumo = entradaResumo - saidaResumo;
              return (
                <div
                  key={mesKey}
                  className="rounded-xl px-3 py-2.5"
                  style={{ background: theme.card, border: `1px solid ${theme.cardBorder}` }}
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span style={{ color: theme.text, fontWeight: 700, fontFamily: HEAD_FONT, fontSize: 14 }}>
                      {mesKey === "sem-data" ? "Sem data" : monthLabel(mesKey)}
                    </span>
                    <span
                      style={{
                        color: saldoResumo >= 0 ? theme.mint : theme.coral,
                        fontWeight: 700,
                        fontFamily: BODY_FONT,
                        fontSize: 14,
                      }}
                    >
                      Saldo: {formatCurrency(saldoResumo)}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 flex-wrap text-xs" style={{ fontFamily: BODY_FONT, color: theme.textMuted }}>
                    <span>Entradas <b style={{ color: theme.mint }}>{formatCurrency(entradaResumo)}</b></span>
                    <span>Saídas <b style={{ color: theme.coral }}>{formatCurrency(saidaResumo)}</b></span>
                  </div>
                </div>
              );
            })}
          </div>
          {mesesComLancamentos.length > 1 && (
            <button
              onClick={() => setVerTodosResumo((v) => !v)}
              className="text-xs font-semibold mt-2"
              style={{ color: theme.mint, fontFamily: BODY_FONT, minHeight: 32 }}
            >
              {verTodosResumo ? "Ver menos" : `Ver mais (${mesesComLancamentos.length - 1})`}
            </button>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {mesesOrdenados.map((mesKey) => {
          const itensReais = porMes[mesKey] || [];
          const pendentesDoMes = pendenciasPorMes[mesKey] || [];
          const itens = [...itensReais, ...pendentesDoMes].sort((a, b) => (a.data < b.data ? 1 : -1));
          const totalEntrada = itensReais.filter((l) => l.tipo === "entrada").reduce((s, l) => s + Number(l.valor), 0);
          const totalSaida = itensReais.filter((l) => l.tipo === "saida").reduce((s, l) => s + Number(l.valor), 0);
          const saldo = totalEntrada - totalSaida;
          const aberto = expandido === mesKey;
          return (
            <div key={mesKey} className="rounded-2xl overflow-hidden" style={{ background: theme.card, border: `1px solid ${theme.cardBorder}` }}>
              <button
                className="w-full flex items-center justify-between px-4 py-3 text-left"
                onClick={() => setExpandido(aberto ? null : mesKey)}
              >
                <div>
                  <div style={{ fontFamily: HEAD_FONT, fontSize: 16, color: theme.text }}>
                    {mesKey === "sem-data" ? "Sem data" : monthLabel(mesKey)}
                  </div>
                  <div className="text-xs" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
                    {itensReais.length} lançamento{itensReais.length === 1 ? "" : "s"}
                    {pendentesDoMes.length > 0 && (
                      <span style={{ color: theme.amber }}> · {pendentesDoMes.length} previsto{pendentesDoMes.length === 1 ? "" : "s"}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span style={{ color: saldo >= 0 ? theme.mint : theme.coral, fontFamily: HEAD_FONT, fontSize: 15 }}>
                    {formatCurrency(saldo)}
                  </span>
                  {aberto ? <ChevronUp size={18} color={theme.textMuted} /> : <ChevronDown size={18} color={theme.textMuted} />}
                </div>
              </button>

              <Collapse open={aberto}>
                <div style={{ borderTop: `1px solid ${theme.divider}` }}>
                  {agruparLancamentos(itens).map((g, gi, arr) =>
                    g.itens.length === 1 ? (
                      <LinhaLancamento key={g.chave} l={g.itens[0]} ultimo={gi === arr.length - 1} />
                    ) : (
                      <GrupoLancamentos key={g.chave} grupo={g} ultimo={gi === arr.length - 1} />
                    )
                  )}
                </div>
              </Collapse>
            </div>
          );
        })}
      </div>

      {modal && (
        <LancamentoModal
          lancamento={modal}
          editando={lancamentos.some((x) => x.id === modal.id)}
          onClose={() => setModal(null)}
          onSave={salvar}
          onDelete={() => {
            excluir(modal.id);
            setModal(null);
          }}
          motos={motos}
        />
      )}
        </>
      )}
    </div>
  );
}

/* ===========================================================
   DASHBOARD
=========================================================== */
// anima o conteúdo aparecendo (fade + subir) só quando ele entra na tela ao rolar —
// dá aquele efeito de "site vivo" conforme você desce a página, sem custar nada em telas menores
function Reveal({ children, delay = 0 }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.12 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(26px)",
        transition: `opacity 0.55s ease ${delay}ms, transform 0.55s cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

const reduceMotion = () =>
  typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// título de seção com um traço colorido do lado — dá um toque de cor variando por
// painel, em vez de todo título ficar no mesmo tom neutro
function SectionTitle({ color = theme.mint, className = "mb-3", children }) {
  return (
    <h3 className={`flex items-center gap-2 ${className}`} style={{ fontFamily: BODY_FONT, fontSize: 13, fontWeight: 600, color: theme.text }}>
      <span style={{ width: 4, height: 14, borderRadius: 2, background: color, boxShadow: `0 0 8px ${color}77`, flexShrink: 0 }} />
      {children}
    </h3>
  );
}

// anima um número subindo do valor anterior até o novo (efeito "contador") sempre que
// `value` muda — dá vida aos números do dashboard sem precisar animar nada além do texto
function CountUp({ value, format, duration = 900 }) {
  const to = Number(value) || 0;
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  const firstRef = useRef(true);

  useEffect(() => {
    // na primeira vez que ESSE card aparece na tela, mostra o valor de cara, sem
    // animar contando de 0 — trocar de aba e voltar pro Início remonta o componente
    // (o conteúdo da aba usa key={tab}), e sem isso o número "piscava" 0 por um
    // instante toda vez que a pessoa voltava pro Início, parecendo um dado errado
    if (firstRef.current) {
      firstRef.current = false;
      fromRef.current = to;
      setDisplay(to);
      return;
    }
    const from = fromRef.current;
    if (reduceMotion() || from === to) {
      setDisplay(to);
      fromRef.current = to;
      return;
    }
    const start = performance.now();
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    let raf = requestAnimationFrame(tick);
    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      setDisplay(from + (to - from) * ease(t));
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
      }
    }
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to, duration]);

  return <>{format ? format(display) : Math.round(display)}</>;
}

// tooltip dos gráficos de linha/barra — some dos gráficos têm, por baixo de cada
// série "de verdade", uma segunda <Line> igual só pra desenhar o cometa de luz por
// cima (mesmo dataKey, sem nome próprio). O tooltip padrão do Recharts lista TODA
// série visível no gráfico, então sem isso cada valor aparecia duas vezes (uma da
// série real, outra do cometa). Aqui filtra, mantendo só a primeira ocorrência de
// cada dataKey — a série real é sempre declarada antes do cometa dela no JSX
function TooltipSemDuplicata({ active, payload, label, formatter }) {
  if (!active || !payload || !payload.length) return null;
  const vistos = new Set();
  const itens = payload.filter((p) => {
    if (vistos.has(p.dataKey)) return false;
    vistos.add(p.dataKey);
    return true;
  });
  return (
    <div
      style={{
        background: theme.panel,
        border: `1px solid ${theme.cardBorder}`,
        borderRadius: 12,
        padding: "8px 12px",
        fontFamily: BODY_FONT,
        fontSize: 12,
      }}
    >
      {label !== undefined && label !== null && (
        <div style={{ color: theme.text, fontWeight: 700, marginBottom: 4 }}>{label}</div>
      )}
      {itens.map((p) => {
        const [valor, nome] = formatter ? formatter(p.value, p.name, p) : [p.value, p.name];
        return (
          <div key={p.dataKey} style={{ color: p.color }}>
            {nome} : {valor}
          </div>
        );
      })}
    </div>
  );
}

function HeroStat({ label, value, format = formatCurrency, icon: Icon, accent, deltaPercent, deltaLabel, sparkData, fill, detalhes, caption, footnote }) {
  const hasDelta = deltaPercent !== null && deltaPercent !== undefined && Number.isFinite(deltaPercent);
  const gradId = `mbrSparkFill-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  // luz clara que passeia por cima da linha do mini-gráfico (não tem relação com a
  // luz que girava em volta do card, essa foi removida — essa aqui é só o traço)
  const brilho = mixColors(accent, "#FFFFFF", 0.65);
  // em zero não é "bom" nem "mau" — não faz sentido destacar com o glow colorido nesses casos
  const semDestaque = !value;

  // "detalhes" (o que compõe esse valor) abre num cartãozinho por cima — no
  // mouse (hover) e/ou toque (clique/tap), sem precisar diferenciar celular de
  // computador: hover abre sozinho no mouse (que não existe no toque), e o clique
  // "fixa" aberto, o que cobre o toque igual. Fecha ao tocar fora, no toque.
  const temDetalhes = Array.isArray(detalhes) && detalhes.length > 0;
  const [hover, setHover] = useState(false);
  const [fixado, setFixado] = useState(false);
  const aberto = temDetalhes && (hover || fixado);
  const cardRef = useRef(null);
  const [popoverRect, setPopoverRect] = useState(null);
  useEffect(() => {
    if (!fixado) return;
    const aoTocarFora = (e) => {
      if (cardRef.current && !cardRef.current.contains(e.target)) setFixado(false);
    };
    document.addEventListener("pointerdown", aoTocarFora);
    return () => document.removeEventListener("pointerdown", aoTocarFora);
  }, [fixado]);
  // o card tem :hover que aplica um transform (o "lift") — isso cria um novo contexto
  // de empilhamento no CSS e prende o z-index do popover lá dentro, então ele nunca
  // consegue aparecer por cima do card vizinho por mais alto que o z-index seja. Por
  // isso o popover é desenhado direto no <body> (portal), com posição calculada a
  // partir do card real, em vez de ficar aninhado dentro do card
  useLayoutEffect(() => {
    if (!aberto || !cardRef.current) return;
    const medir = () => {
      const r = cardRef.current.getBoundingClientRect();
      // com os cards de Lucro/Déficit em 2 colunas, a largura do CARD (r.width) fica
      // pequena demais pra caber "Expansão/investimento" + o valor na mesma linha sem
      // cortar — o popover usa uma largura própria (min 260px, nunca maior que a tela
      // menos margem), não a largura do card que o abriu
      const largura = Math.max(260, Math.min(r.width * 1.8, window.innerWidth - 16));
      const left = Math.max(8, Math.min(r.left, window.innerWidth - largura - 8));
      setPopoverRect({ top: r.bottom + 8, left, width: largura });
    };
    medir();
    // fecha ao rolar em vez de só reposicionar — seguir o card durante o scroll
    // deixava o popover "flutuando" por cima do resto da tela depois que o dedo/mouse
    // já tinha saído dele, um bug visual (a mesma lógica de fechar-ao-rolar já existia
    // no popover de "Próximos 7 dias", ver ValorComDetalhe)
    const fechar = () => {
      setHover(false);
      setFixado(false);
    };
    window.addEventListener("resize", medir);
    window.addEventListener("scroll", fechar, true);
    return () => {
      window.removeEventListener("resize", medir);
      window.removeEventListener("scroll", fechar, true);
    };
  }, [aberto]);

  return (
    <div
      ref={cardRef}
      className={`relative rounded-2xl mbr-card-lift${fill ? " h-full" : ""}${temDetalhes ? " cursor-pointer" : ""}`}
      style={{
        background: `linear-gradient(150deg, ${theme.card} 0%, ${theme.card2} 130%)`,
        boxShadow: semDestaque ? "0 2px 12px rgba(0,0,0,0.22)" : `0 2px 12px rgba(0,0,0,0.22), 0 0 28px ${accent}1F`,
      }}
      onMouseEnter={temDetalhes ? () => setHover(true) : undefined}
      onMouseLeave={temDetalhes ? () => setHover(false) : undefined}
      onClick={temDetalhes ? () => setFixado((v) => !v) : undefined}
    >
      <div
        className={`relative p-5 flex flex-col gap-2 min-w-0${fill ? " h-full" : ""}`}
        style={{
        }}
      >
        <div className="flex items-center justify-between gap-2 min-w-0">
          <span className="text-xs uppercase tracking-wide flex items-center gap-1 min-w-0" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
            {label}
            {temDetalhes && <Info size={11} style={{ flexShrink: 0, opacity: 0.7 }} />}
          </span>
          <div
            className="rounded-full flex items-center justify-center flex-shrink-0"
            style={{ width: 30, height: 30, background: theme.card2 }}
          >
            <Icon size={15} color={accent} />
          </div>
        </div>
        {caption && (
          <span className="text-xs -mt-1.5" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
            {caption}
          </span>
        )}
        <span
          style={{
            fontFamily: HEAD_FONT,
            fontSize: "clamp(19px, 5.5vw, 28px)",
            fontWeight: 700,
            backgroundImage: `linear-gradient(120deg, ${theme.text} 30%, ${accent} 145%)`,
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            WebkitTextFillColor: "transparent",
            color: theme.text,
            lineHeight: 1.15,
            // "normal" (o padrão) só quebra linha em espaço — "break-word" deixava o
            // número em si partir no meio (ex: "6.000," numa linha e "00" na próxima)
            // quando o card ficava estreito (2 colunas). "nowrap" sozinho resolvia a
            // quebra no meio do número, mas fazia o texto vazar pra fora do card
            // quando não cabia numa linha só — por isso aqui é "normal" (permite
            // quebrar), combinado com a troca do espaço fixo (NBSP) por um espaço
            // normal só nesse componente, então a única quebra possível é entre
            // "R$" e o valor, nunca dentro do número
            wordBreak: "normal",
            overflowWrap: "normal",
            whiteSpace: "normal",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <CountUp value={value} format={(v) => (format ? format(v) : Math.round(v)).toString().replace(/ /g, " ")} />
        </span>
        {footnote && (
          <span className="text-xs -mt-1" style={{ color: theme.textMuted, fontFamily: BODY_FONT, fontSize: 12 }}>
            {footnote}
          </span>
        )}
        {hasDelta && (
          <span className="text-xs font-semibold flex items-center gap-1" style={{ color: deltaPercent >= 0 ? theme.mint : theme.coral, fontFamily: BODY_FONT }}>
            {deltaPercent >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {Math.abs(deltaPercent).toFixed(0)}% {deltaLabel}
          </span>
        )}
        {sparkData && sparkData.length > 1 && (
          <div style={{ flex: 1, minHeight: 46, marginTop: 4 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={sparkData} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={accent} stopOpacity={0.5} />
                    <stop offset="100%" stopColor={accent} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area type="monotone" dataKey="v" stroke={accent} strokeWidth={2} fill={`url(#${gradId})`} isAnimationActive={true} dot={false} />
                {/* segundo traçado por cima, igualzinho, só que com um trechinho claro
                    "correndo" ao longo da curva — a linha verde original fica fixa
                    embaixo, essa aqui é só o brilho passeando por cima dela. o vão entre
                    um "cometa" e o outro precisa ser bem maior que a linha mais larga
                    possível (cards grandes no desktop), senão o próximo já nasce antes
                    do primeiro terminar. Essa luz da linha NÃO depende do valor estar
                    zerado — isso é diferente da luz que gira em volta do card */}
                <Line
                  type="monotone"
                  dataKey="v"
                  stroke={brilho}
                  strokeOpacity={0.55}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                  className="mbr-linha-cometa"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
      {aberto &&
        popoverRect &&
        createPortal(
          <div
            className="fixed rounded-2xl p-3 mbr-fade-in"
            style={{
              top: popoverRect.top,
              left: popoverRect.left,
              width: popoverRect.width,
              zIndex: 100,
              background: theme.panel,
              border: `1px solid ${theme.cardBorder}`,
              boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
            }}
            // clicar dentro do cartão de detalhes não deve fechar ele (o listener de
            // "tocar fora" só olha pra fora do card inteiro, isso aqui é redundante mas
            // evita o próprio clique de abrir/fechar do card pai disparar de novo
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col gap-1.5">
              {detalhes.map((d, i) => (
                <div key={i} className="flex items-center justify-between gap-3 text-xs" style={{ fontFamily: BODY_FONT }}>
                  <span style={{ color: theme.textMuted }}>{d.label}</span>
                  <span style={{ color: d.cor || theme.text, fontWeight: 700, whiteSpace: "nowrap" }}>
                    {d.valor < 0 ? "- " : ""}
                    {formatCurrency(Math.abs(d.valor))}
                  </span>
                </div>
              ))}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

// barrinha de progresso (Motos que mais faturam, Gastos por natureza etc.) com o mesmo
// "cometa" de luz atravessando — só dentro da parte já preenchida, nunca no trilho vazio
function BarraComCometa({ pct, color }) {
  const brilho = mixColors(color, "#FFFFFF", 0.65);
  const largura = Math.max(0, Math.min(100, pct || 0));
  return (
    <div style={{ height: 6, borderRadius: 3, background: theme.bg, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${largura}%`, background: color, position: "relative", overflow: "hidden", borderRadius: 3 }}>
        {largura > 0 && (
          <div
            className="absolute inset-y-0 mbr-cometa-barra"
            style={{ width: "40%", background: `linear-gradient(90deg, transparent, ${hexToRgba(brilho, 0.65)}, transparent)` }}
          />
        )}
      </div>
    </div>
  );
}

// "cometa" que gira só dentro da parte preenchida de um anel/arco (0% até onde o
// preenchimento termina) — o mesmo efeito usado nas linhas, padronizado pra qualquer
// gráfico circular do site (Taxa de ocupação, Margem de lucro, Retorno por moto...)
function AnelCometa({ cx, cy, r, clamped, color }) {
  if (!clamped || clamped <= 0) return null;
  const anguloFimDeg = (clamped / 100) * 360;
  return (
    <g transform={`rotate(-90 ${cx} ${cy})`}>
      <g
        className="mbr-cometa-anel"
        style={{
          "--mbr-anel-fim": `${anguloFimDeg}deg`,
          transformBox: "view-box",
          transformOrigin: `${cx}px ${cy}px`,
        }}
      >
        {/* halo maior e mais claro por baixo + pontinho mais forte por cima — deixa o
            "cometa" bem mais visível do que um pontinho sozinho */}
        <circle cx={cx + r} cy={cy} r="4.2" fill={color} opacity={0.35} style={{ filter: `blur(1.5px)` }} />
        <circle cx={cx + r} cy={cy} r="2.8" fill={color} style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
      </g>
    </g>
  );
}

function RadialStat({ label, percent, color, sublabel, bare }) {
  const clamped = Math.max(0, Math.min(100, percent || 0));
  const r = 26;
  const c = 2 * Math.PI * r;
  const offset = c - (clamped / 100) * c;
  const semDestaque = clamped === 0;

  const conteudo = (
    <>
      <svg width={64} height={64} viewBox="0 0 64 64" style={{ flexShrink: 0 }}>
        <circle cx="32" cy="32" r={r} fill="none" stroke={theme.cardBorder} strokeWidth="7" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform="rotate(-90 32 32)"
          style={{ transition: "stroke-dashoffset 0.8s cubic-bezier(0.22, 1, 0.36, 1)" }}
        />
        <text x="32" y="37" textAnchor="middle" fontSize="14" fontWeight="700" fill={theme.text} style={{ fontFamily: HEAD_FONT }}>
          <CountUp value={clamped} format={(v) => `${Math.round(v)}%`} />
        </text>
        <AnelCometa cx={32} cy={32} r={r} clamped={clamped} color={color} />
      </svg>
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-xs uppercase tracking-wide" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
          {label}
        </span>
        {sublabel && (
          <span className="text-xs" style={{ color: theme.text, fontFamily: BODY_FONT }}>
            {sublabel}
          </span>
        )}
      </div>
    </>
  );

  if (bare) {
    return <div className="flex items-center gap-3 min-w-0">{conteudo}</div>;
  }

  return (
    <div
      className="relative rounded-2xl p-5 flex items-center gap-3 min-w-0 mbr-card-lift"
      style={{
        background: `linear-gradient(150deg, ${theme.card} 0%, ${theme.card2} 130%)`,
        boxShadow: semDestaque ? "0 2px 12px rgba(0,0,0,0.22)" : `0 2px 12px rgba(0,0,0,0.22), 0 0 28px ${color}1F`,
      }}
    >
      {conteudo}
    </div>
  );
}

function DashboardView({ motos, lancamentos, clientes, futuros }) {
  const alugadas = motos.filter((m) => m.status === "alugada").length;
  const disponiveis = motos.filter((m) => m.status === "disponivel").length;
  const motosVencidas = motos.filter((m) => m.status === "alugada" && isContratoVencido(m.contratoAtual, pagamentosDaMoto(m, lancamentos)));
  const vencidas = motosVencidas.length;
  // um cliente com pagamento atrasado = uma moto alugada vencida (é 1 pra 1, pelo
  // contratoAtual) — daí a taxa de inadimplência ser sobre o total de clientes
  const taxaInadimplencia = clientes.length > 0 ? (vencidas / clientes.length) * 100 : 0;

  // motos disponíveis e há quanto tempo — usa o fim do último contrato encerrado como
  // "desde quando" está parada; se nunca teve contrato, usa a data de compra
  const diasParadaDaMoto = (moto) => {
    const historico = [...(moto.historicoContratos || [])].sort((a, b) => (a.encerradoEm > b.encerradoEm ? -1 : 1));
    const desde = historico[0]?.encerradoEm || moto.dataCompra;
    if (!desde) return null;
    const inicio = new Date(`${desde}T00:00:00`);
    return Math.max(0, Math.floor((new Date() - inicio) / (1000 * 60 * 60 * 24)));
  };
  const motosParadas = motos
    .filter((m) => m.status === "disponivel")
    .map((m) => ({ placa: m.placa, dias: diasParadaDaMoto(m) }))
    .filter((m) => m.dias !== null)
    .sort((a, b) => b.dias - a.dias);

  const todasManutencoes = motos.flatMap((m) => m.manutencoes || []);

  const now = new Date();
  const mesCalendario = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const mesesComDados = new Set(
    [...lancamentos.map((l) => l.data?.slice(0, 7)), ...todasManutencoes.map((m) => m.data?.slice(0, 7))].filter(Boolean)
  );
  // usa o mês atual se ele já tiver algum lançamento; senão, cai pro mês mais recente com dados
  // (evita mostrar "Lucro do mês" zerado só porque ainda não lançou nada no mês corrente) —
  // mas o usuário pode escolher outro mês pra olhar pelo seletor no topo da tela
  const mesAutoDetectado = mesesComDados.has(mesCalendario) ? mesCalendario : [...mesesComDados].sort().pop() || mesCalendario;
  const [mesEscolhido, setMesEscolhido] = useState(null);
  const mesRef = mesEscolhido || mesAutoDetectado;
  // o botão "Atual" precisa encolher de volta ao ser clicado, não só sumir na hora — por
  // isso continua montado mais um instante enquanto a animação de saída (largura pra 0)
  // termina, só desmonta de fato depois
  const [botaoAtualMontado, setBotaoAtualMontado] = useState(!!mesEscolhido);
  useEffect(() => {
    if (mesEscolhido) {
      setBotaoAtualMontado(true);
      return;
    }
    const t = setTimeout(() => setBotaoAtualMontado(false), 280);
    return () => clearTimeout(t);
  }, [mesEscolhido]);
  const podeAvancarMes = mesRef < mesCalendario;
  const [direcaoMes, setDirecaoMes] = useState(0); // -1 = voltou, 1 = avançou
  const irParaMesAnteriorRef = () => {
    setDirecaoMes(-1);
    const [ano, mesN] = mesRef.split("-").map(Number);
    const d = new Date(ano, mesN - 2, 1);
    setMesEscolhido(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };
  const irParaProximoMesRef = () => {
    if (!podeAvancarMes) return;
    setDirecaoMes(1);
    const [ano, mesN] = mesRef.split("-").map(Number);
    const d = new Date(ano, mesN, 1);
    setMesEscolhido(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };
  const noMes = (data) => data?.slice(0, 7) === mesRef;
  const rotuloMes = monthLabel(mesRef);

  const entradasMes = lancamentos.filter((l) => l.tipo === "entrada" && noMes(l.data)).reduce((s, l) => s + Number(l.valor), 0);
  const saidasOperacionaisMes = lancamentos
    .filter((l) => l.tipo === "saida" && l.natureza !== "Expansão" && noMes(l.data))
    .reduce((s, l) => s + Number(l.valor), 0);
  const manutencaoMes = todasManutencoes.filter((m) => noMes(m.data)).reduce((s, m) => s + Number(m.valorGasto), 0);
  const saidasMes = saidasOperacionaisMes + manutencaoMes;
  const lucroMes = entradasMes - saidasMes;
  const margemLucro = entradasMes > 0 ? (lucroMes / entradasMes) * 100 : 0;
  // "Lucro operacional" ignora investimento/expansão de propósito (compra de moto nova,
  // por exemplo) — é o quanto o negócio rendeu operando no mês. "Saldo de caixa" é o que
  // de fato entrou e saiu da conta, incluindo esses investimentos — os dois às vezes
  // dão número bem diferente no mesmo mês (comprou moto = saldo de caixa negativo, mas
  // lucro operacional pode continuar positivo), por isso mostrar os dois lado a lado
  const investimentosMes = lancamentos.filter((l) => l.tipo === "saida" && l.natureza === "Expansão" && noMes(l.data)).reduce((s, l) => s + Number(l.valor), 0);
  const saldoCaixaMes = lucroMes - investimentosMes;

  // detalhamento pro cartão que abre no hover/toque do Faturamento e do Lucro — agrupa
  // por categoria (entradas) / natureza (saídas) em vez de listar lançamento por
  // lançamento, senão um mês com muitos lançamentos ficaria com uma lista enorme
  const agruparPorChave = (lista, chaveFn, valorFn) => {
    const porChave = new Map();
    lista.forEach((item) => {
      const chave = chaveFn(item) || "Sem categoria";
      porChave.set(chave, (porChave.get(chave) || 0) + Number(valorFn(item)));
    });
    return [...porChave.entries()].sort((a, b) => b[1] - a[1]);
  };
  const detalhesFaturamento = agruparPorChave(
    lancamentos.filter((l) => l.tipo === "entrada" && noMes(l.data)),
    (l) => l.categoria,
    (l) => l.valor
  ).map(([label, valor]) => ({ label, valor, cor: theme.mint }));
  const detalhesLucro = (() => {
    const itens = [{ label: "Entradas", valor: entradasMes, cor: theme.mint }];
    agruparPorChave(
      lancamentos.filter((l) => l.tipo === "saida" && l.natureza !== "Expansão" && noMes(l.data)),
      (l) => l.natureza,
      (l) => l.valor
    ).forEach(([natureza, valor]) => itens.push({ label: natureza, valor: -valor, cor: theme.coral }));
    if (manutencaoMes > 0) itens.push({ label: "Manutenção", valor: -manutencaoMes, cor: theme.coral });
    itens.push({ label: lucroMes >= 0 ? "Lucro" : "Prejuízo", valor: lucroMes, cor: lucroMes >= 0 ? theme.mint : theme.coral });
    return itens;
  })();
  // mesmo detalhamento do Lucro, só que incluindo Expansão/investimento na conta (é
  // exatamente essa diferença que faz Saldo de caixa e Lucro operacional às vezes darem
  // números bem diferentes no mesmo mês)
  const detalhesSaldo = (() => {
    const itens = [{ label: "Entradas", valor: entradasMes, cor: theme.mint }];
    agruparPorChave(
      lancamentos.filter((l) => l.tipo === "saida" && l.natureza !== "Expansão" && noMes(l.data)),
      (l) => l.natureza,
      (l) => l.valor
    ).forEach(([natureza, valor]) => itens.push({ label: natureza, valor: -valor, cor: theme.coral }));
    if (manutencaoMes > 0) itens.push({ label: "Manutenção", valor: -manutencaoMes, cor: theme.coral });
    if (investimentosMes > 0) itens.push({ label: "Expansão/investimento", valor: -investimentosMes, cor: theme.coral });
    itens.push({ label: saldoCaixaMes >= 0 ? "Saldo de caixa" : "Déficit de caixa", valor: saldoCaixaMes, cor: saldoCaixaMes >= 0 ? theme.mint : theme.coral });
    return itens;
  })();

  const [refAno, refMesNum] = mesRef.split("-").map(Number);

  // nunca mostra meses anteriores ao primeiro lançamento — a empresa não existia ainda
  const mesesOrdenadosComDados = [...mesesComDados].sort();
  const primeiroMesComDados = mesesOrdenadosComDados[0] || mesRef;
  const [anoIni, mesIni] = primeiroMesComDados.split("-").map(Number);
  const inicioAbs = anoIni * 12 + (mesIni - 1);
  const fimAbs = refAno * 12 + (refMesNum - 1);
  const mesesDisponiveis = fimAbs - inicioAbs + 1;

  const [periodoGrafico, setPeriodoGrafico] = useState("tudo"); // "3m" | "6m" | "12m" | "tudo"
  const periodoToggleRef = useRef(null);
  const periodoSlotRefs = useRef({});
  const [periodoPillRect, setPeriodoPillRect] = useState(null);

  // mesma pílula deslizante do menu de baixo, agora no seletor 3m/6m/12m/Tudo do gráfico
  useEffect(() => {
    const medir = () => {
      const slot = periodoSlotRefs.current[periodoGrafico];
      const container = periodoToggleRef.current;
      if (!slot || !container) return;
      const slotRect = slot.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      setPeriodoPillRect({ left: slotRect.left - containerRect.left, top: slotRect.top - containerRect.top, width: slotRect.width, height: slotRect.height });
    };
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, [periodoGrafico]);

  const [mostrarInvestimentos, setMostrarInvestimentos] = useState(false);
  // ao aparecer, deixa o próprio Recharts desenhar a linha se formando da esquerda pra
  // direita (a animação padrão dele); ao esconder, como ele não anima a saída, continua
  // montada mais um instante enquanto a opacidade cai suavemente até zero antes de tirar
  const [investMontada, setInvestMontada] = useState(false);
  const [investOpaca, setInvestOpaca] = useState(false);
  useEffect(() => {
    if (mostrarInvestimentos) {
      setInvestMontada(true);
      setInvestOpaca(true);
      return;
    }
    setInvestOpaca(false);
    const t = setTimeout(() => setInvestMontada(false), 300);
    return () => clearTimeout(t);
  }, [mostrarInvestimentos]);
  const [verTodasRetorno, setVerTodasRetorno] = useState(false);
  const [valoresOcultos, setValoresOcultos] = useState(false);
  const fmt = valoresOcultos ? () => "R$ ••••••" : formatCurrency;
  const fmtCompact = valoresOcultos ? () => "•••" : formatCompact;

  const qtdMesesAlvo = { "3m": 3, "6m": 6, "12m": 12, tudo: mesesDisponiveis }[periodoGrafico] || mesesDisponiveis;
  const qtdMeses = Math.max(1, Math.min(qtdMesesAlvo, mesesDisponiveis));

  const meses = [];
  for (let i = qtdMeses - 1; i >= 0; i--) {
    const abs = fimAbs - i;
    const ano = Math.floor(abs / 12);
    const mesN = (abs % 12) + 1;
    meses.push(`${ano}-${String(mesN).padStart(2, "0")}`);
  }
  const chartData = meses.map((key) => {
    const doMesX = lancamentos.filter((l) => l.data?.slice(0, 7) === key);
    const manut = todasManutencoes.filter((m) => m.data?.slice(0, 7) === key).reduce((s, m) => s + Number(m.valorGasto), 0);
    const entradasDoMes = doMesX.filter((l) => l.tipo === "entrada").reduce((s, l) => s + Number(l.valor), 0);
    const saidasDoMes = doMesX.filter((l) => l.tipo === "saida" && l.natureza !== "Expansão").reduce((s, l) => s + Number(l.valor), 0) + manut;
    return {
      mes: monthLabel(key),
      Entradas: entradasDoMes,
      Saídas: saidasDoMes,
      Investimentos: doMesX.filter((l) => l.tipo === "saida" && l.natureza === "Expansão").reduce((s, l) => s + Number(l.valor), 0),
      Lucro: entradasDoMes - saidasDoMes,
    };
  });

  // mini-gráfico de tendência do faturamento — sempre os últimos meses com dados,
  // independente do filtro (3m/6m/12m/tudo) escolhido pro gráfico principal
  const sparkMeses = Math.min(6, mesesDisponiveis);
  const sparkFaturamento = Array.from({ length: sparkMeses }, (_, i) => {
    const abs = fimAbs - (sparkMeses - 1 - i);
    const ano = Math.floor(abs / 12);
    const mesN = (abs % 12) + 1;
    const key = `${ano}-${String(mesN).padStart(2, "0")}`;
    const v = lancamentos.filter((l) => l.tipo === "entrada" && l.data?.slice(0, 7) === key).reduce((s, l) => s + Number(l.valor), 0);
    return { v };
  });

  const porNatureza = NATUREZAS.map((n) => ({
    natureza: n,
    total: lancamentos.filter((l) => l.tipo === "saida" && l.natureza === n).reduce((s, l) => s + Number(l.valor), 0),
  }));
  const maxNatureza = Math.max(1, ...porNatureza.map((n) => n.total));

  const taxaOcupacao = motos.length ? Math.round((alugadas / motos.length) * 100) : 0;
  const contratosAtivos = motos.filter((m) => m.contratoAtual);
  // só entram os contratos que JÁ podem ser cobrados no mês em questão — um contrato
  // fechado neste mês só gera cobrança no mês que vem (aluguel é pago no fim do
  // período), e contar ele aqui inflava o previsto do mês assim que a moto era alugada
  const contratosCobraveisNoMes = contratosAtivos.filter((m) => contratoCobraNoMes(m.contratoAtual, mesRef));
  const faturamentoPrevisto = contratosCobraveisNoMes.reduce((s, m) => s + Number(m.contratoAtual.valorMensal || 0), 0);
  // o ticket médio é sobre o valor dos contratos ativos (quanto vale um aluguel), não
  // sobre o que entra neste mês — por isso continua usando todos os ativos
  const ticketMedio = contratosAtivos.length
    ? contratosAtivos.reduce((s, m) => s + Number(m.contratoAtual.valorMensal || 0), 0) / contratosAtivos.length
    : 0;
  const investimentoFrota = motos.reduce((s, m) => s + Number(m.valorCompra || 0), 0);

  // inclui tanto manutenção cadastrada na própria moto quanto lançada direto no Caixa
  // (natureza "Manutenção") — só pra exibição do ranking, não entra de novo no lucro
  const rankingManutencao = motos
    .map((m) => ({ placa: m.placa, modelo: m.modelo, total: manutencoesDaMoto(m, lancamentos).reduce((s, x) => s + Number(x.valorGasto || 0), 0) }))
    .filter((m) => m.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);
  const maxManutencao = Math.max(1, ...rankingManutencao.map((m) => m.total));

  const rankingFaturamento = motos
    .filter((m) => m.contratoAtual)
    .map((m) => ({ placa: m.placa, total: Number(m.contratoAtual.valorMensal || 0) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);
  const maxFaturamentoMoto = Math.max(1, ...rankingFaturamento.map((m) => m.total));

  // retorno do investimento por moto — quanto já foi "recuperado" (estimado a partir do
  // valor mensal do contrato x meses decorridos) vs quanto custou (compra + custos extras + manutenção)
  const retornoPorMoto = motos
    .map((m) => {
      const custosExtrasTotal = custosDaMoto(m, lancamentos).reduce((s, c) => s + Number(c.valorGasto || 0), 0);
      const manutencaoTotal = (m.manutencoes || []).reduce((s, x) => s + Number(x.valorGasto || 0), 0);
      const investimentoTotal = Number(m.valorCompra || 0) + custosExtrasTotal + manutencaoTotal;
      const receitaMensal = m.contratoAtual ? Number(m.contratoAtual.valorMensal || 0) : 0;

      // recebido de verdade — soma os lançamentos de entrada que citam a placa dessa moto
      // (é assim que o fluxo de caixa já é lançado, ex: "Mensalidade URB5I50")
      const recebidoReal = pagamentosDaMoto(m, lancamentos).reduce((s, p) => s + Number(p.valor), 0);
      const restante = Math.max(0, investimentoTotal - recebidoReal);
      const mesesRestantes = receitaMensal > 0 ? Math.ceil(restante / receitaMensal) : null;
      const percentPago = investimentoTotal > 0 ? Math.min(100, (recebidoReal / investimentoTotal) * 100) : 0;

      return { placa: m.placa, investimentoTotal, recebidoReal, receitaMensal, percentPago, mesesRestantes, jaPagou: restante <= 0 && investimentoTotal > 0 };
    })
    .filter((r) => r.investimentoTotal > 0)
    .sort((a, b) => b.percentPago - a.percentPago);

  // mesma base do retorno por moto, só que ordenada por tempo (quantos meses faltam),
  // não por porcentagem — a mais perto de se pagar primeiro, sem contrato ativo por
  // último (não dá pra estimar quando não tem mensalidade rodando)
  const paybackPorMoto = [...retornoPorMoto].sort((a, b) => {
    if (a.jaPagou !== b.jaPagou) return a.jaPagou ? -1 : 1;
    if (a.mesesRestantes == null && b.mesesRestantes == null) return 0;
    if (a.mesesRestantes == null) return 1;
    if (b.mesesRestantes == null) return -1;
    return a.mesesRestantes - b.mesesRestantes;
  });

  // mês anterior ao mês de referência — usado só pra calcular a variação (%) dos KPIs principais
  const mesAnteriorKey = (() => {
    const d = new Date(refAno, refMesNum - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  })();
  const noMesAnterior = (data) => data?.slice(0, 7) === mesAnteriorKey;
  const entradasMesAnterior = lancamentos.filter((l) => l.tipo === "entrada" && noMesAnterior(l.data)).reduce((s, l) => s + Number(l.valor), 0);
  const saidasOperacionaisMesAnterior = lancamentos
    .filter((l) => l.tipo === "saida" && l.natureza !== "Expansão" && noMesAnterior(l.data))
    .reduce((s, l) => s + Number(l.valor), 0);
  const manutencaoMesAnterior = todasManutencoes.filter((m) => noMesAnterior(m.data)).reduce((s, m) => s + Number(m.valorGasto), 0);
  const lucroMesAnterior = entradasMesAnterior - (saidasOperacionaisMesAnterior + manutencaoMesAnterior);
  const deltaFaturamento = entradasMesAnterior > 0 ? ((entradasMes - entradasMesAnterior) / entradasMesAnterior) * 100 : null;
  const deltaLucro = lucroMesAnterior !== 0 ? ((lucroMes - lucroMesAnterior) / Math.abs(lucroMesAnterior)) * 100 : null;
  const rotuloMesAnterior = monthLabel(mesAnteriorKey);

  const totalClientes = clientes?.length || 0;
  const faturamentoAcumulado = lancamentos.filter((l) => l.tipo === "entrada").reduce((s, l) => s + Number(l.valor), 0);
  // essa KPI é só uma exibição do total gasto em manutenção (moto + Caixa) — não entra
  // no cálculo de lucro, que usa "todasManutencoes" (só as cadastradas na própria moto)
  // pra não contar duas vezes o que já é uma saída normal do Caixa
  const manutencaoAcumulada = motos.reduce((s, m) => s + manutencoesDaMoto(m, lancamentos).reduce((s2, x) => s2 + Number(x.valorGasto || 0), 0), 0);
  const contratosEncerrados = motos.reduce((s, m) => s + (m.historicoContratos?.length || 0), 0);

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
        <h2 style={{ fontFamily: HEAD_FONT, fontSize: 22, fontWeight: 700, color: theme.mint }}>Visão geral</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setValoresOcultos((v) => !v)}
            className="mbr-hover-grow flex items-center justify-center rounded-full"
            title={valoresOcultos ? "Mostrar valores" : "Ocultar valores"}
            style={{ width: 44, height: 44, background: theme.card, border: `1px solid ${theme.outline}`, color: theme.text, transition: "transform 0.18s ease" }}
          >
            {valoresOcultos ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
          <div className="flex items-center gap-1 rounded-full px-1.5 py-1" style={{ background: theme.card, border: `1px solid ${theme.cardBorder}` }}>
            <button onClick={irParaMesAnteriorRef} className="mbr-hover-grow flex items-center justify-center rounded-full" style={{ width: 26, height: 26, color: theme.text }}>
              <ChevronLeft size={16} />
            </button>
            <span className="relative inline-block overflow-hidden align-middle" style={{ minWidth: 74, height: 15 }}>
              {/* um span só, remontado (via key) a cada mês — sem manter o texto antigo
                  na tela junto com o novo, então nunca tem risco de um ficar sobreposto
                  no outro, misturando as letras dos dois meses por um instante */}
              <span
                key={rotuloMes}
                className="absolute inset-0 text-xs font-semibold text-center"
                style={{
                  color: theme.text,
                  fontFamily: BODY_FONT,
                  animation: `${direcaoMes >= 0 ? "mbrMesEntraDireita" : "mbrMesEntraEsquerda"} 0.26s cubic-bezier(0.32, 0.72, 0, 1) both`,
                }}
              >
                {rotuloMes}
              </span>
            </span>
            <button
              onClick={irParaProximoMesRef}
              disabled={!podeAvancarMes}
              className={podeAvancarMes ? "mbr-hover-grow flex items-center justify-center rounded-full" : "flex items-center justify-center rounded-full"}
              style={{ width: 26, height: 26, color: podeAvancarMes ? theme.text : theme.textMuted, opacity: podeAvancarMes ? 1 : 0.4, cursor: podeAvancarMes ? "pointer" : "default" }}
            >
              <ChevronRight size={16} />
            </button>
            {botaoAtualMontado && (
              <button
                onClick={() => setMesEscolhido(null)}
                className={`text-xs font-semibold rounded-full px-2 py-1 ml-1 ${mesEscolhido ? "mbr-botao-atual-entra" : "mbr-botao-atual-sai"}`}
                style={{ background: hexToRgba(theme.mint, 0.16), color: theme.mint, fontFamily: BODY_FONT, whiteSpace: "nowrap", overflow: "hidden" }}
              >
                Atual
              </button>
            )}
          </div>
        </div>
      </div>


      {/* KPIs principais — Faturamento é o card alto com mini-gráfico. Lucro operacional
          e Saldo de caixa ficam lado a lado embaixo: o primeiro ignora investimento/
          expansão de propósito (comprar moto nova não é "prejuízo operacional"), o
          segundo conta tudo que de fato entrou/saiu da conta — os dois às vezes dão
          número bem diferente no mesmo mês, por isso mostrar os dois junto com legenda */}
      <Reveal>
        <HeroStat
          label={`Faturamento (${rotuloMes})`}
          value={entradasMes}
          format={fmt}
          icon={TrendingUp}
          accent={theme.mint}
          deltaPercent={deltaFaturamento}
          deltaLabel={`vs ${rotuloMesAnterior}`}
          sparkData={sparkFaturamento}
          detalhes={detalhesFaturamento}
        />
      </Reveal>

      {/* Lucro operacional + Déficit de caixa logo depois do Faturamento — par
          pequeno/quadrado; Payback (grande) vem depois, e só então Inadimplência +
          Motos paradas (outro par pequeno) */}
      <Reveal delay={60}>
        <div className="grid grid-cols-2 gap-3 mb-3 mt-3">
          <HeroStat
            label={`${lucroMes >= 0 ? "Lucro operacional" : "Prejuízo operacional"} (${rotuloMes})`}
            caption="sem investimentos"
            footnote={`margem: ${margemLucro.toFixed(1)}%`}
            value={Math.abs(lucroMes)}
            format={fmt}
            icon={Wallet}
            accent={lucroMes >= 0 ? theme.mint : theme.coral}
            deltaPercent={deltaLucro}
            deltaLabel={`vs ${rotuloMesAnterior}`}
            detalhes={detalhesLucro}
          />
          <HeroStat
            label={`${saldoCaixaMes >= 0 ? "Saldo de caixa" : "Déficit de caixa"} (${rotuloMes})`}
            caption="com investimentos"
            value={Math.abs(saldoCaixaMes)}
            format={fmt}
            icon={Landmark}
            accent={saldoCaixaMes >= 0 ? theme.mint : theme.coral}
            detalhes={detalhesSaldo}
          />
        </div>
      </Reveal>

      {paybackPorMoto.length > 0 && (
        <Reveal delay={70}>
          <div className="rounded-2xl p-4 mb-3 mbr-card-lift" style={{ background: `linear-gradient(150deg, ${theme.card} 0%, ${theme.card2} 130%)`, border: `1px solid ${theme.cardBorder}` }}>
            <div className="flex items-center justify-between mb-1">
              <SectionTitle color={theme.mint} className="">Payback por moto</SectionTitle>
              {paybackPorMoto.length > 8 && (
                <button
                  onClick={() => setVerTodasRetorno((v) => !v)}
                  className="text-xs font-semibold flex-shrink-0"
                  style={{ color: theme.mint, fontFamily: BODY_FONT }}
                >
                  {verTodasRetorno ? "Ver menos" : `Ver mais (${paybackPorMoto.length - 8})`}
                </button>
              )}
            </div>
            <div className="text-xs mb-3" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
              Quanto falta pra cada moto se pagar (compra + custos + manutenção), da mais perto pra mais longe.
            </div>
            <div className="flex flex-col gap-3">
              {(verTodasRetorno ? paybackPorMoto : paybackPorMoto.slice(0, 8)).map((r) => {
                const clamped = Math.max(0, Math.min(100, r.percentPago));
                // cor comunica "quão perto está de bater o olho": verde até 6 meses,
                // âmbar de 7 a 12, vermelho acima disso — sem contrato ativo fica neutro
                // (não dá pra comparar prazo de algo que não está gerando receita agora)
                const cor = r.jaPagou
                  ? theme.mint
                  : r.mesesRestantes == null
                  ? theme.textFaint
                  : r.mesesRestantes <= 6
                  ? theme.mint
                  : r.mesesRestantes <= 12
                  ? theme.amber
                  : theme.coral;
                const legenda = r.jaPagou ? "Pago" : r.mesesRestantes != null ? `faltam ~${r.mesesRestantes} ${r.mesesRestantes === 1 ? "mês" : "meses"}` : "sem contrato ativo";
                return (
                  <div key={r.placa} title={valoresOcultos ? undefined : `${formatCurrency(r.recebidoReal)} de ${formatCurrency(r.investimentoTotal)}`}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span style={{ fontFamily: MONO_FONT, fontWeight: 500, color: theme.text }}>{formatPlaca(r.placa)}</span>
                      <span style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>{legenda}</span>
                    </div>
                    <BarraComCometa pct={clamped} color={cor} />
                  </div>
                );
              })}
            </div>
          </div>
        </Reveal>
      )}

      <Reveal delay={80}>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="rounded-2xl p-4 mbr-card-lift" style={{ background: `linear-gradient(150deg, ${theme.card} 0%, ${theme.card2} 130%)`, border: `1px solid ${theme.cardBorder}` }}>
            <div className="flex items-center gap-2 mb-2">
              <div
                className="rounded-full flex items-center justify-center flex-shrink-0"
                style={{ width: 30, height: 30, background: theme.card2 }}
              >
                <AlertTriangle size={14} color={theme.coral} />
              </div>
              <span className="text-xs uppercase tracking-wide" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
                Taxa de inadimplência
              </span>
            </div>
            <div style={{ fontFamily: HEAD_FONT, fontSize: 24, fontWeight: 600, color: vencidas > 0 ? theme.coral : theme.text }}>
              <CountUp value={taxaInadimplencia} format={(v) => `${v.toFixed(1)}%`} />
            </div>
            <div className="text-xs mt-0.5" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
              {vencidas} de {clientes.length} cliente{clientes.length === 1 ? "" : "s"} com pagamento atrasado
            </div>
          </div>

          <div className="rounded-2xl p-4 mbr-card-lift" style={{ background: `linear-gradient(150deg, ${theme.card} 0%, ${theme.card2} 130%)`, border: `1px solid ${theme.cardBorder}` }}>
            <div className="flex items-center gap-2 mb-2">
              <div
                className="rounded-full flex items-center justify-center flex-shrink-0"
                style={{ width: 30, height: 30, background: theme.card2 }}
              >
                <Timer size={14} color={theme.amber} />
              </div>
              <span className="text-xs uppercase tracking-wide" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
                Motos paradas
              </span>
            </div>
            {motosParadas.length === 0 ? (
              <div className="text-xs" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
                Nenhuma moto disponível parada agora.
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {motosParadas.slice(0, 3).map((m) => (
                  <div key={m.placa} className="flex items-center justify-between text-xs">
                    <span style={{ fontFamily: MONO_FONT, fontWeight: 500, color: theme.text }}>{formatPlaca(m.placa)}</span>
                    <span style={{ color: m.dias > 30 ? theme.coral : theme.textMuted, fontFamily: BODY_FONT }}>
                      há {m.dias} dia{m.dias === 1 ? "" : "s"}
                    </span>
                  </div>
                ))}
                {motosParadas.length > 3 && (
                  <div className="text-xs mt-0.5" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
                    +{motosParadas.length - 3} outra{motosParadas.length - 3 === 1 ? "" : "s"} parada{motosParadas.length - 3 === 1 ? "" : "s"}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </Reveal>
      {!mesEscolhido && mesRef !== mesCalendario && (
        <div className="text-xs mb-3" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
          Ainda não há lançamentos em {monthLabel(mesCalendario)} — mostrando o último mês com movimento.
        </div>
      )}

      {/* Indicadores secundários — grade fixa (2 colunas no celular), pra não quebrar torto */}
      <Reveal delay={80}>
        <div
          className="rounded-2xl mb-3 p-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mbr-card-lift"
          style={{ background: `linear-gradient(150deg, ${theme.card} 0%, ${theme.card2} 130%)`, border: `1px solid ${theme.cardBorder}` }}
        >
          {[
            { icon: TrendingUp, label: "Faturamento previsto/mês", value: faturamentoPrevisto, format: fmt, accent: theme.mint },
            { icon: TrendingDown, label: `Gastos operacionais (${rotuloMes})`, value: saidasMes, format: fmt, accent: theme.coral },
            { icon: Wallet, label: "Ticket médio", value: ticketMedio, format: fmt, accent: theme.mint },
            { icon: Users, label: "Total de clientes", value: totalClientes, accent: theme.textMuted },
            { icon: TrendingUp, label: "Investido em frota", value: investimentoFrota, format: fmt, accent: theme.textMuted },
            { icon: Wallet, label: "Faturamento acumulado", value: faturamentoAcumulado, format: fmt, accent: theme.mint },
            { icon: Wrench, label: "Manutenção acumulada", value: manutencaoAcumulada, format: fmt, accent: theme.coral },
            { icon: FileText, label: "Contratos encerrados", value: contratosEncerrados, accent: theme.textMuted },
          ].map((s) => (
            <div key={s.label} className="flex items-center gap-2 min-w-0">
              <div
                className="rounded-full flex items-center justify-center flex-shrink-0"
                style={{ width: 30, height: 30, background: theme.card2 }}
              >
                <s.icon size={14} color={s.accent} />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-xs truncate" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
                  {s.label}
                </span>
                <span style={{ fontFamily: HEAD_FONT, fontWeight: 700, fontSize: 14, color: theme.text }}>
                  <CountUp value={s.value} format={s.format} />
                </span>
              </div>
            </div>
          ))}
        </div>
      </Reveal>

      {/* Status da frota — anel + números, um card só */}
      <Reveal delay={140}>
        <div
          className="rounded-2xl p-4 mb-4 flex items-center gap-5 flex-wrap mbr-card-lift"
          style={{ background: `linear-gradient(150deg, ${theme.card} 0%, ${theme.card2} 130%)`, border: `1px solid ${theme.cardBorder}` }}
        >
          <RadialStat bare label="Taxa de ocupação" percent={taxaOcupacao} color={theme.amber} sublabel={`${alugadas} de ${motos.length} motos`} />
          <div className="flex-1 grid grid-cols-4 gap-2 min-w-[220px]" style={{ borderLeft: `1px solid ${theme.divider}`, paddingLeft: 16 }}>
            {[
              { label: "Motos", value: motos.length, color: theme.text },
              { label: "Alugadas", value: alugadas, color: theme.amber },
              { label: "Disponíveis", value: disponiveis, color: theme.mint },
              { label: "Atrasados", value: vencidas, color: vencidas > 0 ? theme.coral : theme.textMuted },
            ].map((it) => (
              <div key={it.label} className="min-w-0">
                <div style={{ fontFamily: HEAD_FONT, fontSize: 19, fontWeight: 700, color: it.color }}>
                  <CountUp value={it.value} />
                </div>
                <div className="text-xs truncate" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
                  {it.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Reveal>

      <Reveal delay={0}>
      <div className="rounded-2xl p-4 mb-4 mbr-card-lift" style={{ background: `linear-gradient(150deg, ${theme.card} 0%, ${theme.card2} 130%)`, border: `1px solid ${theme.cardBorder}` }}>
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <SectionTitle color={theme.mint} className="">Entradas, saídas e lucro</SectionTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <div ref={periodoToggleRef} className="relative flex rounded-full overflow-hidden" style={{ border: `1px solid ${theme.cardBorder}` }}>
              {periodoPillRect && (
                <span
                  className="absolute rounded-full"
                  style={{
                    left: 0,
                    top: periodoPillRect.top,
                    width: periodoPillRect.width,
                    height: periodoPillRect.height,
                    background: theme.mint,
                    willChange: "transform",
                    transform: `translateX(${periodoPillRect.left}px)`,
                    transition: "transform 0.28s cubic-bezier(0.32, 0.72, 0, 1)",
                  }}
                />
              )}
              {[
                { id: "3m", label: "3m" },
                { id: "6m", label: "6m" },
                { id: "12m", label: "12m" },
                { id: "tudo", label: "Tudo" },
              ].map((op) => (
                <button
                  key={op.id}
                  ref={(el) => (periodoSlotRefs.current[op.id] = el)}
                  onClick={() => setPeriodoGrafico(op.id)}
                  className="relative text-xs font-semibold px-2.5 py-1"
                  style={{
                    color: periodoGrafico === op.id ? theme.mintText : theme.textMuted,
                    transition: "color 0.15s ease",
                    zIndex: 1,
                  }}
                >
                  {op.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setMostrarInvestimentos((v) => !v)}
              className="text-xs font-semibold rounded-full px-2.5 py-1"
              style={{
                border: `1px solid ${theme.outline}`,
                background: mostrarInvestimentos ? theme.card2 : "transparent",
                color: mostrarInvestimentos ? theme.text : theme.textMuted,
              }}
            >
              Investimentos
            </button>
          </div>
        </div>
        <div className="flex gap-4 mb-3 text-xs flex-wrap" style={{ fontFamily: BODY_FONT }}>
          <span style={{ color: theme.mint }}>Entradas no período: {fmt(chartData.reduce((s, d) => s + d.Entradas, 0))}</span>
          <span style={{ color: theme.coral }}>Saídas no período: {fmt(chartData.reduce((s, d) => s + d.Saídas, 0))}</span>
          {investMontada && (
            <span style={{ color: theme.textMuted, opacity: investOpaca ? 1 : 0, transition: "opacity 0.3s ease" }}>
              Investido no período: {fmt(chartData.reduce((s, d) => s + d.Investimentos, 0))}
            </span>
          )}
        </div>
        <div style={{ width: "100%", height: 260 }}>
          <ResponsiveContainer>
            <ComposedChart data={chartData}>
              <defs>
                <linearGradient id="mbrGradEntradas" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={theme.mint} stopOpacity={0.45} />
                  <stop offset="100%" stopColor={theme.mint} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="mbrGradSaidas" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={theme.coral} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={theme.coral} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="mbrGradInvest" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={theme.chartMuted} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={theme.chartMuted} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="mbrGradLucro" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={theme.amber} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={theme.amber} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.cardBorder} vertical={false} />
              <XAxis dataKey="mes" stroke={theme.textMuted} fontSize={12} axisLine={false} tickLine={false} />
              <YAxis yAxisId="left" stroke={theme.textMuted} fontSize={11} tickFormatter={fmtCompact} width={56} axisLine={false} tickLine={false} />
              <YAxis
                yAxisId="right"
                orientation="right"
                stroke={theme.amber}
                fontSize={11}
                tickFormatter={fmtCompact}
                width={56}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<TooltipSemDuplicata formatter={(value, name) => [fmt(value), name]} />} />
              <Legend />
              {/* Lucro vem PRIMEIRO (mais embaixo na pilha de desenho) porque usa uma escala
                  (eixo direito) diferente da de Entradas/Saídas — o "zero" dele cai numa
                  altura de tela diferente do de Entradas/Saídas, então o preenchimento dele
                  podia acabar desenhado por cima da LINHA das outras duas (não só do fundo).
                  Desenhando-o antes, Entradas e Saídas sempre ficam por cima, nunca tampadas. */}
              <Area
                yAxisId="right"
                type="monotone"
                dataKey="Lucro"
                // sem isso, quando o lucro fica negativo o preenchimento "inverte" e
                // aparece ACIMA da linha (a área é sempre calculada até o zero, então em
                // valores negativos ela sobe em vez de descer) — com baseValue="dataMin"
                // o preenchimento sempre vai da linha até o menor valor do gráfico,
                // ficando sempre por baixo, nunca por cima
                baseValue="dataMin"
                stroke={theme.amber}
                strokeWidth={2.5}
                fill="url(#mbrGradLucro)"
                dot={{ r: 3, fill: theme.amber, strokeWidth: 0 }}
                activeDot={{ r: 5 }}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="Lucro"
                stroke={mixColors(theme.amber, "#FFFFFF", 0.65)}
                strokeOpacity={0.55}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
                legendType="none"
                className="mbr-linha-cometa"
              />
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="Entradas"
                stroke={theme.mint}
                strokeWidth={2.5}
                fill="url(#mbrGradEntradas)"
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="Entradas"
                stroke={mixColors(theme.mint, "#FFFFFF", 0.65)}
                strokeOpacity={0.55}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
                legendType="none"
                className="mbr-linha-cometa"
              />
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="Saídas"
                stroke={theme.coral}
                strokeWidth={2.5}
                fill="url(#mbrGradSaidas)"
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="Saídas"
                stroke={mixColors(theme.coral, "#FFFFFF", 0.65)}
                strokeOpacity={0.55}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
                legendType="none"
                className="mbr-linha-cometa"
              />
              {investMontada && (
                <>
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="Investimentos"
                    stroke={theme.chartMuted}
                    strokeWidth={2.5}
                    fill="url(#mbrGradInvest)"
                    strokeOpacity={investOpaca ? 1 : 0}
                    fillOpacity={investOpaca ? 1 : 0}
                    style={{ transition: "fill-opacity 0.3s ease, stroke-opacity 0.3s ease" }}
                    isAnimationActive={investOpaca}
                    animationDuration={900}
                    animationEasing="ease-out"
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                  {investOpaca && (
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="Investimentos"
                      stroke={mixColors(theme.chartMuted, "#FFFFFF", 0.65)}
                      strokeOpacity={0.55}
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                      legendType="none"
                      className="mbr-linha-cometa"
                    />
                  )}
                </>
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
      </Reveal>

      {(futuros || []).length > 0 && (
        <Reveal delay={50}>
          <div className="rounded-2xl p-4 mb-4 mbr-card-lift" style={{ background: `linear-gradient(150deg, ${theme.card} 0%, ${theme.card2} 130%)`, border: `1px solid ${theme.cardBorder}` }}>
            <SectionTitle>Contas futuras</SectionTitle>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {(() => {
                const { previstoEntrada12Meses, previstoSaida12Meses, saldoPrevisto12Meses } = totaisFuturos(futuros, motos);
                return (
                  <>
                    <div>
                      <div className="text-xs uppercase tracking-wide mb-1" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
                        A receber (12 meses)
                      </div>
                      <div style={{ fontFamily: HEAD_FONT, fontSize: 18, color: theme.mint }}>{fmt(previstoEntrada12Meses)}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide mb-1" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
                        A pagar (12 meses)
                      </div>
                      <div style={{ fontFamily: HEAD_FONT, fontSize: 18, color: theme.coral }}>{fmt(previstoSaida12Meses)}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide mb-1" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
                        Saldo previsto
                      </div>
                      <div style={{ fontFamily: HEAD_FONT, fontSize: 18, color: saldoPrevisto12Meses >= 0 ? theme.mint : theme.coral }}>
                        {fmt(saldoPrevisto12Meses)}
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
            <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${theme.divider}` }}>
              <div className="text-xs uppercase tracking-wide mb-2" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
                Próximos 7 dias
              </div>
              <div className="grid grid-cols-2 gap-3">
                {(() => {
                  const { entrada: entrada7d, saida: saida7d, itensEntrada: itensEntrada7d, itensSaida: itensSaida7d } = futurosProximosDias(futuros, motos, 7);
                  return (
                    <>
                      <div>
                        <div className="text-xs mb-1" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
                          A receber
                        </div>
                        <ValorComDetalhe itens={itensEntrada7d} fmt={fmt}>
                          <div style={{ fontFamily: HEAD_FONT, fontSize: 18, color: theme.mint }}>{fmt(entrada7d)}</div>
                        </ValorComDetalhe>
                      </div>
                      <div>
                        <div className="text-xs mb-1" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
                          A pagar
                        </div>
                        <ValorComDetalhe itens={itensSaida7d} fmt={fmt}>
                          <div style={{ fontFamily: HEAD_FONT, fontSize: 18, color: theme.coral }}>{fmt(saida7d)}</div>
                        </ValorComDetalhe>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        </Reveal>
      )}

      <Reveal>
      <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        <div className="rounded-2xl p-4 mbr-card-lift" style={{ background: `linear-gradient(150deg, ${theme.card} 0%, ${theme.card2} 130%)`, border: `1px solid ${theme.cardBorder}` }}>
          <SectionTitle color={theme.mint}>Motos que mais faturam/mês</SectionTitle>
          {rankingFaturamento.length === 0 ? (
            <div className="text-xs" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
              Nenhuma moto alugada no momento.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {rankingFaturamento.map((m) => (
                <div key={m.placa}>
                  <div className="flex justify-between text-xs mb-1" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
                    <span>{formatPlaca(m.placa)}</span>
                    <span>{fmt(m.total)}</span>
                  </div>
                  <BarraComCometa pct={(m.total / maxFaturamentoMoto) * 100} color={theme.mint} />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl p-4 mbr-card-lift" style={{ background: `linear-gradient(150deg, ${theme.card} 0%, ${theme.card2} 130%)`, border: `1px solid ${theme.cardBorder}` }}>
          <SectionTitle color={theme.coral}>Gastos por natureza (total)</SectionTitle>
          <div className="flex flex-col gap-2">
            {porNatureza.map((n) => (
              <div key={n.natureza}>
                <div className="flex justify-between text-xs mb-1" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
                  <span>{n.natureza}</span>
                  <span>{fmt(n.total)}</span>
                </div>
                <BarraComCometa pct={(n.total / maxNatureza) * 100} color={theme.coral} />
              </div>
            ))}
          </div>
        </div>

        {rankingManutencao.length > 0 && (
          <div className="rounded-2xl p-4 mbr-card-lift" style={{ background: `linear-gradient(150deg, ${theme.card} 0%, ${theme.card2} 130%)`, border: `1px solid ${theme.cardBorder}` }}>
            <SectionTitle color={theme.coral}>Maiores gastos de manutenção</SectionTitle>
            <div className="flex flex-col gap-2">
              {rankingManutencao.map((m) => (
                <div key={m.placa}>
                  <div className="flex justify-between text-xs mb-1" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
                    <span>{formatPlaca(m.placa)}</span>
                    <span>{fmt(m.total)}</span>
                  </div>
                  <BarraComCometa pct={(m.total / maxManutencao) * 100} color={theme.coral} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      </Reveal>
    </div>
  );
}

/* ===========================================================
   CONFIGURAÇÕES — logo própria + cores do site
=========================================================== */
const LINK_RASTREIO_PADRAO = "https://web.melocaliza.com.br/sharing/126b3fd40579524296cf586b7625cd97";

function RastreioView({ config, motos, clientes, topInset, bottomInset }) {
  const link = config?.linkRastreioGeral || LINK_RASTREIO_PADRAO;
  return (
    <TrackingMap
      link={link}
      height="100%"
      rounded={false}
      motos={motos}
      clientes={clientes}
      topInset={topInset}
      bottomInset={bottomInset}
    />
  );
}

// os dois únicos níveis que dá pra atribuir por aqui — "admin" nunca aparece como opção,
// fica travado com quem criou a conta no primeiro acesso (bootstrap)
const NIVEIS_USUARIO = [
  { value: "editor", label: "Editor", desc: "Vê e edita motos, clientes e caixa", icon: Pencil },
  { value: "visualizador", label: "Visualizador", desc: "Só consegue ver, não edita nada", icon: Eye },
];

function SeletorNivel({ value, onChange }) {
  return (
    <div className="flex flex-col gap-2 mb-3">
      {NIVEIS_USUARIO.map((n) => {
        const Icon = n.icon;
        const ativo = value === n.value;
        return (
          <button
            key={n.value}
            type="button"
            onClick={() => onChange(n.value)}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left"
            style={{
              background: ativo ? `${theme.mint}1F` : theme.card2,
              border: `1px solid ${ativo ? theme.mint : theme.cardBorder}`,
            }}
          >
            <Icon size={16} color={ativo ? theme.mint : theme.textMuted} />
            <div className="min-w-0">
              <div style={{ color: theme.text, fontFamily: BODY_FONT, fontWeight: 600, fontSize: 14 }}>{n.label}</div>
              <div style={{ color: theme.textMuted, fontFamily: BODY_FONT, fontSize: 12 }}>{n.desc}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function NovoUsuarioModal({ onClose, onSaved }) {
  const [username, setUsername] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [role, setRole] = useState("editor");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  // o "usuário" vira um email por trás dos panos (usuario@mobirelli.local) — se a
  // pessoa digitar um email de verdade aqui, dá um email inválido (dois "@") e o
  // Supabase recusa com uma mensagem genérica que não explica o motivo real
  const pareceEmail = username.includes("@");

  const salvar = async () => {
    if (!username.trim() || senha.length < 6) {
      setErro("Informe um usuário e uma senha com pelo menos 6 caracteres.");
      return;
    }
    if (pareceEmail) {
      setErro("O usuário não pode ser um email — use só um nome ou apelido, sem @.");
      return;
    }
    if (senha !== confirmar) {
      setErro("As senhas não são iguais.");
      return;
    }
    setEnviando(true);
    setErro("");
    const resultado = await chamarAdminApi("criar", { username, senha, role });
    setEnviando(false);
    if (!resultado.ok) {
      setErro(resultado.erro);
      return;
    }
    onSaved();
  };

  return (
    <Modal title="Novo usuário" onClose={onClose}>
      <FieldLabel>Usuário</FieldLabel>
      <input style={inputStyle} value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
      {pareceEmail && (
        <div className="text-xs mb-3 -mt-2 flex items-center gap-1" style={{ color: theme.amber, fontFamily: BODY_FONT }}>
          <AlertTriangle size={13} /> Isso parece um email — use só um nome ou apelido, sem @.
        </div>
      )}
      <CampoSenha label="Senha (mínimo 6 caracteres)" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="new-password" />
      <CampoSenha label="Confirmar senha" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} autoComplete="new-password" />
      <FieldLabel>Nível de acesso</FieldLabel>
      <SeletorNivel value={role} onChange={setRole} />
      {erro && (
        <div className="text-xs mb-3 flex items-center gap-1" style={{ color: theme.coral, fontFamily: BODY_FONT }}>
          <AlertTriangle size={13} /> {erro}
        </div>
      )}
      <button
        onClick={salvar}
        disabled={enviando}
        className="w-full rounded-xl py-2 font-semibold"
        style={{ background: theme.mint, color: theme.text, fontWeight: 600, opacity: enviando ? 0.7 : 1 }}
      >
        {enviando ? "Criando..." : "Criar usuário"}
      </button>
    </Modal>
  );
}

function RedefinirSenhaModal({ usuario, onClose, onSaved }) {
  const [senha, setSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  const salvar = async () => {
    if (senha.length < 6) {
      setErro("A senha precisa ter pelo menos 6 caracteres.");
      return;
    }
    if (senha !== confirmar) {
      setErro("As senhas não são iguais.");
      return;
    }
    setEnviando(true);
    setErro("");
    const resultado = await chamarAdminApi("redefinir-senha", { userId: usuario.id, senha });
    setEnviando(false);
    if (!resultado.ok) {
      setErro(resultado.erro);
      return;
    }
    onSaved();
  };

  return (
    <Modal title={`Redefinir senha — ${usuario.username}`} onClose={onClose}>
      <CampoSenha label="Nova senha (mínimo 6 caracteres)" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="new-password" />
      <CampoSenha label="Confirmar nova senha" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} autoComplete="new-password" />
      {erro && (
        <div className="text-xs mb-3 flex items-center gap-1" style={{ color: theme.coral, fontFamily: BODY_FONT }}>
          <AlertTriangle size={13} /> {erro}
        </div>
      )}
      <button
        onClick={salvar}
        disabled={enviando}
        className="w-full rounded-xl py-2 font-semibold"
        style={{ background: theme.mint, color: theme.text, fontWeight: 600, opacity: enviando ? 0.7 : 1 }}
      >
        {enviando ? "Salvando..." : "Salvar nova senha"}
      </button>
    </Modal>
  );
}

// só aparece pra quem é admin — lista quem tem login, cria gente nova, redefine senha e
// desativa/reativa acesso. Toda mudança passa por chamarAdminApi (api/admin-usuarios.js
// no servidor, com a service role key) — daqui só se lê a lista (perfis é público pra
// leitura, sem senha nenhuma nela) e se dispara as ações
// um único visual pra qualquer badge de cargo/status — fundo sólido igual pra todos,
// só a cor do texto/ícone muda por tipo (nunca contorno, nunca fundo diferente)
function CargoBadge({ icon: Icon, children, color }) {
  return (
    <span
      className="text-xs font-semibold rounded-full px-2 py-0.5 flex items-center gap-1 flex-shrink-0"
      style={{ background: theme.card2, color, lineHeight: 1 }}
    >
      {Icon && <Icon size={11} style={{ display: "block", flexShrink: 0 }} />}
      <span>{children}</span>
    </span>
  );
}

function UsuariosSection({ meuId }) {
  const [usuarios, setUsuarios] = useState(null); // null = carregando
  const [erro, setErro] = useState("");
  const [modal, setModal] = useState(null); // { type: "novo" } | { type: "senha", usuario }

  const carregar = async () => {
    const resultado = await listarUsuarios();
    if (!resultado.ok) {
      setErro(resultado.erro);
      return;
    }
    setUsuarios(resultado.usuarios);
  };

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const excluirUsuario = async (usuario) => {
    const ok = window.confirm(`Excluir o usuário "${usuario.username}" para sempre? O login dele deixa de existir e não dá pra desfazer.`);
    if (!ok) return;
    const resultado = await chamarAdminApi("excluir", { userId: usuario.id });
    if (!resultado.ok) {
      setErro(resultado.erro);
      return;
    }
    carregar();
  };

  const alternarRole = async (usuario) => {
    const novoRole = usuario.role === "editor" ? "visualizador" : "editor";
    const resultado = await chamarAdminApi("definir-role", { userId: usuario.id, role: novoRole });
    if (!resultado.ok) {
      setErro(resultado.erro);
      return;
    }
    carregar();
  };

  return (
    <div className="rounded-2xl p-4 mb-4" style={{ background: theme.card, border: `1px solid ${theme.cardBorder}` }}>
      <div className="flex items-center justify-between mb-3">
        <FieldLabel>Usuários com acesso</FieldLabel>
        <button
          onClick={() => setModal({ type: "novo" })}
          className="text-xs font-semibold rounded-xl px-3 py-1.5 flex items-center gap-1"
          style={{ background: theme.mint, color: theme.text, fontWeight: 600 }}
        >
          <Plus size={14} /> Novo usuário
        </button>
      </div>

      {erro && (
        <div className="text-xs mb-3 flex items-center gap-1" style={{ color: theme.coral, fontFamily: BODY_FONT }}>
          <AlertTriangle size={13} /> {erro}
        </div>
      )}

      {usuarios === null ? (
        <div className="mbr-skel" style={{ height: 60 }} />
      ) : usuarios.length === 0 ? (
        <div style={{ color: theme.textMuted, fontSize: 12 }}>Nenhum usuário cadastrado.</div>
      ) : (
        <div className="flex flex-col gap-2">
          {usuarios.map((u) => (
            <div key={u.id} className="flex items-center justify-between gap-2 rounded-xl px-3 py-2" style={{ background: theme.card2 }}>
              <div className="flex items-center gap-2 min-w-0">
                <div style={{ color: theme.text, fontFamily: BODY_FONT, fontWeight: 600 }} className="truncate">
                  {u.username}
                </div>
                {u.role === "admin" ? (
                  <CargoBadge icon={ShieldCheck} color={theme.amber}>Admin</CargoBadge>
                ) : (
                  <CargoBadge icon={u.role === "editor" ? Pencil : Eye} color={u.role === "editor" ? theme.mint : theme.textMuted}>
                    {u.role === "editor" ? "Editor" : "Visualizador"}
                  </CargoBadge>
                )}
                {!u.ativo && <CargoBadge color={theme.coral}>Desativado</CargoBadge>}
              </div>
              <div className="flex items-center flex-shrink-0" style={{ marginRight: -10 }}>
                {u.role !== "admin" && (
                  <button
                    onClick={() => alternarRole(u)}
                    className="flex items-center justify-center mbr-hover-grow"
                    style={{ color: theme.textMuted, width: 40, height: 40 }}
                    title={u.role === "editor" ? "Trocar pra Visualizador" : "Trocar pra Editor"}
                  >
                    {u.role === "editor" ? <Eye size={15} /> : <Pencil size={15} />}
                  </button>
                )}
                <button
                  onClick={() => setModal({ type: "senha", usuario: u })}
                  className="flex items-center justify-center mbr-hover-grow"
                  style={{ color: theme.textMuted, width: 40, height: 40 }}
                  title="Redefinir senha"
                >
                  <KeyRound size={15} />
                </button>
                {u.id !== meuId && (
                  <button
                    onClick={() => excluirUsuario(u)}
                    className="flex items-center justify-center mbr-hover-grow"
                    style={{ color: theme.textMuted, width: 40, height: 40, marginRight: -8 }}
                    title="Excluir usuário"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {modal?.type === "novo" && (
        <NovoUsuarioModal
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            carregar();
          }}
        />
      )}
      {modal?.type === "senha" && (
        <RedefinirSenhaModal usuario={modal.usuario} onClose={() => setModal(null)} onSaved={() => setModal(null)} />
      )}
    </div>
  );
}

function ConfiguracoesView({ config, persist, perfil, onSignOut }) {
  const [local, setLocal] = useState(config);
  const [status, setStatus] = useState({ text: "", kind: "" }); // kind: "ok" | "erro" | ""
  const logoInputRef = useRef(null);

  // se outra pessoa (ex. seu pai) mudar as configurações, reflete aqui
  useEffect(() => {
    setLocal(config);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.logoDataUrl, config.logoSize, config.linkRastreioGeral]);

  const salvarAgora = async (next) => {
    setStatus({ text: "Salvando...", kind: "" });
    await persist(next);
    setStatus({ text: "Salvo ✓", kind: "ok" });
    setTimeout(() => setStatus({ text: "", kind: "" }), 1800);
  };

  const handleLogo = (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setStatus({ text: "Imagem acima de 5MB — tente uma versão menor.", kind: "erro" });
      return;
    }
    setStatus({ text: "Enviando logo...", kind: "" });
    (async () => {
      const url = await uploadArquivo(`logo-${Date.now()}-${nomeArquivoSeguro(file.name)}`, file);
      if (!url) {
        setStatus({ text: "Não foi possível enviar a logo agora.", kind: "erro" });
        return;
      }
      const next = { ...local, logoDataUrl: url, logoName: file.name };
      setLocal(next);
      await persist(next);
      setStatus({ text: "Logo salva ✓", kind: "ok" });
      setTimeout(() => setStatus({ text: "", kind: "" }), 1800);
    })();
  };

  const removerLogo = () => {
    const next = { ...local, logoDataUrl: "", logoName: "" };
    setLocal(next);
    salvarAgora(next);
  };

  return (
    <div>
      <h2 style={{ fontFamily: HEAD_FONT, fontSize: 22, fontWeight: 700, color: theme.mint }} className="mb-4">
        Configurações
      </h2>

      <div className="rounded-2xl p-4 mb-4 flex items-center justify-between gap-3" style={{ background: theme.card, border: `1px solid ${theme.cardBorder}` }}>
        <div className="min-w-0">
          <div style={{ color: theme.textMuted, fontFamily: BODY_FONT, fontSize: 12 }}>Logado como</div>
          <div className="flex items-center gap-1.5 truncate" style={{ color: theme.text, fontFamily: BODY_FONT, fontWeight: 600 }}>
            {perfil?.username}
            {perfil?.role === "admin" && <ShieldCheck size={14} color={theme.amber} />}
          </div>
        </div>
        <button
          onClick={onSignOut}
          className="text-xs font-semibold rounded-xl px-3 py-2 flex items-center gap-1.5 flex-shrink-0"
          style={{ background: theme.card2, color: theme.coral }}
        >
          <LogOut size={14} /> Sair
        </button>
      </div>

      {perfil?.role === "admin" && <UsuariosSection meuId={perfil.id} />}

      {permissoes.podeEditar && (
      <>
      <div className="rounded-2xl p-4 mb-4" style={{ background: theme.card, border: `1px solid ${theme.cardBorder}` }}>
        <FieldLabel>Logo da empresa</FieldLabel>
        <div className="flex items-center gap-3 mb-2">
          <div
            className="flex items-center justify-center rounded-xl"
            style={{ width: 64, height: 64, background: theme.bg, border: `1px solid ${theme.cardBorder}` }}
          >
            {local.logoDataUrl ? (
              <img src={local.logoDataUrl} alt="Logo atual" style={{ maxWidth: 56, maxHeight: 56 }} />
            ) : (
              <ImageIcon size={22} color={theme.textMuted} />
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <input ref={logoInputRef} type="file" accept="image/*" onChange={handleLogo} style={{ display: "none" }} />
            <button
              type="button"
              onClick={() => logoInputRef.current?.click()}
              className="text-xs font-semibold rounded-xl px-3 py-1.5"
              style={{ background: theme.mint, color: theme.text, fontWeight: 600 }}
            >
              Enviar imagem da logo
            </button>
            {local.logoDataUrl && (
              <button type="button" onClick={removerLogo} className="text-xs font-semibold" style={{ color: theme.coral }}>
                Remover e usar a marca padrão
              </button>
            )}
          </div>
        </div>
        <div className="text-xs mb-3" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
          PNG com fundo transparente funciona melhor. Até 5MB.
        </div>

        {local.logoDataUrl && (
          <div className="pt-3" style={{ borderTop: `1px solid ${theme.divider}` }}>
            <div className="flex items-center justify-between mb-1.5">
              <span style={{ color: theme.text, fontFamily: BODY_FONT, fontSize: 13, fontWeight: 600 }}>
                Tamanho da logo no topo
              </span>
              <span style={{ color: theme.textMuted, fontFamily: BODY_FONT, fontSize: 12 }}>
                {local.logoSize || 38}px
              </span>
            </div>
            <input
              type="range"
              min={24}
              max={90}
              step={2}
              value={local.logoSize || 38}
              onChange={(e) => setLocal((l) => ({ ...l, logoSize: Number(e.target.value) }))}
              onMouseUp={() => salvarAgora({ ...local })}
              onTouchEnd={() => salvarAgora({ ...local })}
              style={{ width: "100%", accentColor: theme.mint }}
            />
          </div>
        )}
      </div>

      <div className="rounded-2xl p-4 mb-4" style={{ background: theme.card, border: `1px solid ${theme.cardBorder}` }}>
        <FieldLabel>Link de rastreio (aba Rastreio)</FieldLabel>
        <input
          style={inputStyle}
          value={local.linkRastreioGeral || ""}
          onChange={(e) => setLocal((l) => ({ ...l, linkRastreioGeral: e.target.value }))}
          onBlur={() => salvarAgora(local)}
          placeholder="https://web.melocaliza.com.br/sharing/..."
        />
        <div className="text-xs -mt-2" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
          Na Melocaliza: Compartilhar localização → Novo → selecione todas as motos → validade "Nenhum" → copie o link.
        </div>
      </div>

      </>
      )}

      {status.text && (
        <div
          className="text-xs font-semibold rounded-xl px-3 py-2 inline-block"
          style={{
            color: status.kind === "erro" ? theme.coral : theme.mint,
            background: status.kind === "erro" ? `${theme.coral}1F` : `${theme.mint}1F`,
            fontFamily: BODY_FONT,
          }}
        >
          {status.text}
        </div>
      )}
    </div>
  );
}

/* ===========================================================
   DADOS DA PLANILHA — extraídos de Mobirelli_280726.xlsx em 30/07/2026.
   Manutenções já ficam dentro de cada moto (não duplicadas no fluxo de
   caixa, que na planilha original registrava as mesmas manutenções de novo).
=========================================================== */
const SEED_CLIENTES = [
  { id: "cli-avant", nome: "AVANT", cpfCnpj: "34.174.750/0001-76", telefone: "(11) 97476-3443", email: "", cep: "12955-000", logradouro: "", numero: "", bairro: "", cidade: "", estado: "", observacoes: "" },
  { id: "cli-maicon", nome: "MAICON H. DOS REIS", cpfCnpj: "230.216.468-75", telefone: "(19) 99856-4356", email: "", cep: "13503-665", logradouro: "", numero: "", bairro: "", cidade: "", estado: "", observacoes: "" },
  { id: "cli-celio", nome: "CELIO ROBERTO ALVES", cpfCnpj: "297.288.148-60", telefone: "(19) 98202-8449", email: "", cep: "13506-663", logradouro: "", numero: "", bairro: "", cidade: "", estado: "", observacoes: "" },
  { id: "cli-luciano", nome: "LUCIANO P. DE BARROS", cpfCnpj: "250.556.978-90", telefone: "(11) 97495-9121", email: "", cep: "13257-210", logradouro: "", numero: "", bairro: "", cidade: "", estado: "", observacoes: "" },
  { id: "cli-thiago", nome: "THIAGO A. DE OLIVEIRA P.", cpfCnpj: "357.086.398-06", telefone: "(19) 99291-2925", email: "", cep: "13253-291", logradouro: "", numero: "", bairro: "", cidade: "", estado: "", observacoes: "" },
  { id: "cli-andre", nome: "ANDRE LUIZ BRITO DA S.", cpfCnpj: "367.349.848-77", telefone: "(11) 97861-7040", email: "", cep: "13255-064", logradouro: "", numero: "", bairro: "", cidade: "", estado: "", observacoes: "" },
];

const SEED_MOTOS = [
  {
    id: "moto-urb5i50", modelo: "JTZ/NK150", placa: "URB5I50", chassi: "99KJCK4PKVM128207", renavam: "1492671867",
    dataCompra: "2026-05-08", nfNumero: "000009496", valorCompra: 17372.64, notaFiscalAnexos: [], status: "alugada",
    contratoAtual: { id: "ctr-urb-1", clienteId: "cli-avant", numeroContrato: 1, numeroClienteMoto: 1, dataInicio: "", dataVencimento: "", valorMensal: 1590, formaPagamento: "Boleto Bancário", anexos: [] },
    historicoContratos: [],
    manutencoes: [
      { id: "mnt-urb-1", data: "2026-06-05", tipo: "Troca de Óleo", valorGasto: 55, local: "Turella Com. Motopeças", garantia: false },
      { id: "mnt-urb-2", data: "2026-06-05", tipo: "Diversos", valorGasto: 25, local: "Turella Com. Motopeças", garantia: false },
      { id: "mnt-urb-3", data: "2026-06-05", tipo: "Suporte Placa", valorGasto: 15, local: "Turella Com. Motopeças", garantia: false },
      { id: "mnt-urb-4", data: "2026-06-30", tipo: "Troca de Óleo", valorGasto: 55, local: "Turella Com. Motopeças", garantia: false },
      { id: "mnt-urb-5", data: "2026-07-24", tipo: "Troca de Óleo", valorGasto: 55, local: "Turella Com. Motopeças", garantia: false },
    ],
  },
  {
    id: "moto-uoi5d36", modelo: "JTZ/DK160 S", placa: "UOI5D36", chassi: "99KPCKBCJVM218308", renavam: "1498255997",
    dataCompra: "2026-06-11", nfNumero: "000009841", valorCompra: 15880.31, notaFiscalAnexos: [], status: "alugada",
    contratoAtual: { id: "ctr-uoi-2", clienteId: "cli-andre", numeroContrato: 2, numeroClienteMoto: 2, dataInicio: "", dataVencimento: "", valorMensal: 1428, formaPagamento: "Boleto Bancário", anexos: [] },
    historicoContratos: [
      { id: "ctr-uoi-1", clienteId: "cli-maicon", numeroContrato: 1, numeroClienteMoto: 1, dataInicio: "", dataVencimento: "", valorMensal: 1600, formaPagamento: "Boleto Bancário", anexos: [], encerradoEm: "" },
    ],
    manutencoes: [{ id: "mnt-uoi-1", data: "2026-07-01", tipo: "Troca de Óleo", valorGasto: 60, local: "F. M. Basses Motopeças", garantia: false }],
  },
  {
    id: "moto-uou1d13", modelo: "JTZ/DK160 S", placa: "UOU1D13", chassi: "99KPCKBCJVM220650", renavam: "1501043355",
    dataCompra: "2026-06-27", nfNumero: "000009981", valorCompra: 15810.31, notaFiscalAnexos: [], status: "alugada",
    contratoAtual: { id: "ctr-uou-1", clienteId: "cli-celio", numeroContrato: 1, numeroClienteMoto: 1, dataInicio: "", dataVencimento: "", valorMensal: 1600, formaPagamento: "Boleto Bancário", anexos: [] },
    historicoContratos: [],
    manutencoes: [],
  },
  {
    id: "moto-uon6i43", modelo: "JTZ/DK160 S", placa: "UON6I43", chassi: "99KPCKBCJVM220655", renavam: "1501070379",
    dataCompra: "2026-06-27", nfNumero: "000009982", valorCompra: 15810.31, notaFiscalAnexos: [], status: "alugada",
    contratoAtual: { id: "ctr-uon-1", clienteId: "cli-luciano", numeroContrato: 1, numeroClienteMoto: 1, dataInicio: "", dataVencimento: "", valorMensal: 1440, formaPagamento: "Boleto Bancário", anexos: [] },
    historicoContratos: [],
    manutencoes: [{ id: "mnt-uon-1", data: "2026-07-08", tipo: "Pneu", valorGasto: 160, local: "Turella Com. Motopeças", garantia: false }],
  },
  {
    id: "moto-uoo1a56", modelo: "JTZ/DK160 S", placa: "UOO1A56", chassi: "99KPCKBCJVM220675", renavam: "1503860997",
    dataCompra: "2026-07-16", nfNumero: "000010159", valorCompra: 15810.31, notaFiscalAnexos: [], status: "alugada",
    contratoAtual: { id: "ctr-uoo-1", clienteId: "cli-thiago", numeroContrato: 1, numeroClienteMoto: 1, dataInicio: "", dataVencimento: "", valorMensal: 1400, formaPagamento: "Boleto Bancário", anexos: [] },
    historicoContratos: [],
    manutencoes: [],
  },
  {
    id: "moto-upm5c78", modelo: "JTZ/DK160 S", placa: "UPM5C78", chassi: "99KPCKBCJVM220331", renavam: "1503855217",
    dataCompra: "2026-07-16", nfNumero: "000010158", valorCompra: 15810.31, notaFiscalAnexos: [], status: "preparacao",
    contratoAtual: null,
    historicoContratos: [],
    manutencoes: [],
  },
];

const SEED_FLUXO = [
  { id: "flx-1", tipo: "saida", natureza: "Administrativo", data: "2026-05-03", categoria: "LR Moraes", forma: "", valor: 450, descricao: "" },
  { id: "flx-2", tipo: "saida", natureza: "Expansão", data: "2026-05-06", categoria: "Consultoria Rogerio", forma: "Pix Fê", valor: 45000, descricao: "" },
  { id: "flx-3", tipo: "saida", natureza: "Expansão", data: "2026-05-06", categoria: "Abertura Empresa (LR Moraes)", forma: "Pix Itau FÊ", valor: 1700, descricao: "" },
  { id: "flx-4", tipo: "saida", natureza: "Expansão", data: "2026-05-12", categoria: "Consultoria Rogerio", forma: "Pix Fê", valor: 25000, descricao: "" },
  { id: "flx-5", tipo: "saida", natureza: "Expansão", data: "2026-05-15", categoria: "Corpo de Bombeiros", forma: "", valor: 600, descricao: "" },
  { id: "flx-6", tipo: "saida", natureza: "Expansão", data: "2026-05-22", categoria: "Certificado Digital", forma: "", valor: 230, descricao: "" },
  { id: "flx-7", tipo: "saida", natureza: "Operacional", data: "2026-06-01", categoria: "Seguro", forma: "", valor: 119.9, descricao: "" },
  { id: "flx-8", tipo: "saida", natureza: "Administrativo", data: "2026-06-03", categoria: "LR Moraes", forma: "Pix NuBank Mobirelli", valor: 450, descricao: "" },
  { id: "flx-9", tipo: "saida", natureza: "Expansão", data: "2026-06-12", categoria: "Grizzotti Despachante", forma: "Pix NuBank Mobirelli", valor: 930, descricao: "" },
  { id: "flx-10", tipo: "entrada", natureza: "Operacional", data: "2026-06-23", categoria: "Mensalidade URB5I50", forma: "Boleto Bancário", valor: 1590, descricao: "" },
  { id: "flx-11", tipo: "saida", natureza: "Operacional", data: "2026-06-23", categoria: "TAXA Rogério", forma: "Pix NuBank Mobirelli", valor: 200, descricao: "" },
  { id: "flx-12", tipo: "saida", natureza: "Operacional", data: "2026-06-25", categoria: "Logística (UBER)", forma: "Cartão Mobirelli", valor: 58.97, descricao: "" },
  { id: "flx-13", tipo: "saida", natureza: "Operacional", data: "2026-06-25", categoria: "Logística (UBER)", forma: "Cartão Mobirelli", valor: 59.98, descricao: "" },
  { id: "flx-14", tipo: "saida", natureza: "Expansão", data: "2026-06-27", categoria: "2 motos Suzuki", forma: "Cartão GUI", valor: 2706.22, descricao: "" },
  { id: "flx-15", tipo: "saida", natureza: "Expansão", data: "2026-06-27", categoria: "Comissão Rogério", forma: "Pix NuBank Mobirelli", valor: 6400, descricao: "" },
  { id: "flx-16", tipo: "saida", natureza: "Expansão", data: "2026-06-30", categoria: "Grizzotti Despachante", forma: "Pix NuBank Mobirelli", valor: 950, descricao: "" },
  { id: "flx-17", tipo: "saida", natureza: "Expansão", data: "2026-06-30", categoria: "Grizzotti Despachante", forma: "Pix NuBank Mobirelli", valor: 950, descricao: "" },
  { id: "flx-18", tipo: "saida", natureza: "Administrativo", data: "2026-07-02", categoria: "LR Moraes", forma: "Pix NuBank Mobirelli", valor: 450, descricao: "" },
  { id: "flx-19", tipo: "saida", natureza: "Expansão", data: "2026-07-16", categoria: "2 motos Suzuki", forma: "Pix NuBank Mobirelli", valor: 31620.74, descricao: "" },
  { id: "flx-20", tipo: "saida", natureza: "Expansão", data: "2026-07-20", categoria: "Grizzotti Despachante", forma: "Pix NuBank Mobirelli", valor: 1820, descricao: "" },
  { id: "flx-21", tipo: "saida", natureza: "Expansão", data: "2026-07-21", categoria: "Comissão Rogério", forma: "Pix NuBank Mobirelli", valor: 6400, descricao: "" },
  { id: "flx-22", tipo: "entrada", natureza: "Operacional", data: "2026-07-21", categoria: "Mensalidade URB5I50", forma: "Boleto Bancário", valor: 1588.29, descricao: "" },
  { id: "flx-23", tipo: "entrada", natureza: "Operacional", data: "2026-07-23", categoria: "Mensalidade UOI5D36", forma: "Boleto Bancário", valor: 1598.02, descricao: "" },
  { id: "flx-24", tipo: "saida", natureza: "Administrativo", data: "2026-07-25", categoria: "Fatura nubank Mobirelli", forma: "Pix NuBank Mobirelli", valor: 378.77, descricao: "" },
  { id: "flx-25", tipo: "saida", natureza: "Operacional", data: "2026-07-26", categoria: "Seguro Melocaliza", forma: "Pix NuBank Mobirelli", valor: 689.4, descricao: "" },
];

/* ===========================================================
   LOGIN
=========================================================== */
// campo de senha com botão de mostrar/esconder — reaproveitado no login, na criação do
// administrador e na tela de Usuários
function CampoSenha({ label, value, onChange, autoComplete }) {
  const [visivel, setVisivel] = useState(false);
  return (
    <>
      <FieldLabel>{label}</FieldLabel>
      <div className="relative">
        <input
          type={visivel ? "text" : "password"}
          style={{ ...inputStyle, paddingRight: 36 }}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
        />
        <button
          type="button"
          onClick={() => setVisivel((v) => !v)}
          className="absolute"
          style={{ right: 10, top: 9, color: theme.textMuted }}
          tabIndex={-1}
        >
          {visivel ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </>
  );
}

function TelaCentralizada({ children }) {
  // telas de login/criação de admin são só um formulário centralizado — não tem
  // motivo pra rolar. Trava o scroll enquanto uma dessas telas está montada e
  // devolve ao normal ao saída (não é uma regra global do app, só dessas telas)
  useEffect(() => {
    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = anterior;
    };
  }, []);

  return (
    <div
      className="h-screen flex items-center justify-center px-6"
      style={{ background: theme.bg, overflow: "hidden" }}
    >
      <div className="w-full" style={{ maxWidth: 340 }}>
        <div className="flex flex-col items-center gap-3 mb-8">
          <img src="/login-icon.png" alt="" style={{ height: 56, width: "auto", objectFit: "contain" }} />
          <img src="/login-logo.png" alt="Mobirelli" style={{ height: 64, width: "auto", objectFit: "contain" }} />
        </div>
        {children}
      </div>
    </div>
  );
}

function LoginView() {
  const [username, setUsername] = useState("");
  const [senha, setSenha] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  const entrar = async (e) => {
    e.preventDefault();
    if (!username.trim() || !senha) return;
    setEnviando(true);
    setErro("");
    const resultado = await signIn(username, senha);
    if (!resultado.ok) setErro(resultado.erro);
    setEnviando(false);
  };

  return (
    <TelaCentralizada>
      <form onSubmit={entrar} className="rounded-2xl p-5" style={{ background: theme.card, border: `1px solid ${theme.cardBorder}` }}>
        <h2 className="text-center mb-4" style={{ fontFamily: HEAD_FONT, fontSize: 20, color: theme.text }}>
          Entrar
        </h2>
        <FieldLabel>Usuário</FieldLabel>
        <input style={inputStyle} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus />
        <CampoSenha label="Senha" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" />
        {erro && (
          <div className="text-xs mb-3 flex items-center gap-1" style={{ color: theme.coral, fontFamily: BODY_FONT }}>
            <AlertTriangle size={13} /> {erro}
          </div>
        )}
        <button
          type="submit"
          disabled={enviando}
          className="w-full rounded-xl py-2.5 font-semibold"
          style={{ background: theme.mint, color: theme.text, fontWeight: 600, opacity: enviando ? 0.7 : 1 }}
        >
          {enviando ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </TelaCentralizada>
  );
}

function CriarAdminView() {
  const [username, setUsername] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  const criar = async (e) => {
    e.preventDefault();
    if (!username.trim() || senha.length < 6) return;
    if (senha !== confirmar) {
      setErro("As senhas não são iguais.");
      return;
    }
    setEnviando(true);
    setErro("");
    const resultado = await chamarAdminApi("bootstrap-admin", { username, senha });
    if (!resultado.ok) {
      setErro(resultado.erro);
      setEnviando(false);
      return;
    }
    // a conta já foi criada — agora só falta entrar com ela
    const loginResultado = await signIn(username, senha);
    if (!loginResultado.ok) setErro(loginResultado.erro);
    setEnviando(false);
  };

  return (
    <TelaCentralizada>
      <form onSubmit={criar} className="rounded-2xl p-5" style={{ background: theme.card, border: `1px solid ${theme.cardBorder}` }}>
        <div className="flex justify-center mb-2">
          <ShieldCheck size={28} color={theme.mint} />
        </div>
        <h2 className="text-center mb-1" style={{ fontFamily: HEAD_FONT, fontSize: 20, color: theme.text }}>
          Criar administrador
        </h2>
        <div className="text-center text-xs mb-4" style={{ color: theme.textMuted, fontFamily: BODY_FONT }}>
          Primeiro acesso ao sistema — essa conta vira a administradora. As próximas pessoas só entram com um login criado por ela.
        </div>
        <FieldLabel>Usuário</FieldLabel>
        <input style={inputStyle} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus />
        <CampoSenha label="Senha (mínimo 6 caracteres)" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="new-password" />
        <CampoSenha label="Confirmar senha" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} autoComplete="new-password" />
        {erro && (
          <div className="text-xs mb-3 flex items-center gap-1" style={{ color: theme.coral, fontFamily: BODY_FONT }}>
            <AlertTriangle size={13} /> {erro}
          </div>
        )}
        <button
          type="submit"
          disabled={enviando}
          className="w-full rounded-xl py-2.5 font-semibold"
          style={{ background: theme.mint, color: theme.text, fontWeight: 600, opacity: enviando ? 0.7 : 1 }}
        >
          {enviando ? "Criando..." : "Criar administrador"}
        </button>
      </form>
    </TelaCentralizada>
  );
}

/* ===========================================================
   APP PRINCIPAL — só monta depois do login (ver MobirelliRoot, no fim do
   arquivo), pra os hooks de dados (useSharedList/useSharedObject) só
   rodarem pra quem já está autenticado
=========================================================== */
function AppAutenticado({ perfil, onSignOut }) {
  const versaoNovaDisponivel = useVersaoNova();
  const [tab, setTab] = useState("dashboard");
  // cada aba é remontada (key={tab}) mas a rolagem é da JANELA, que o React não reseta
  // sozinho — sem isso, trocar de aba enquanto a anterior estava rolada pra baixo abre
  // a aba nova já no meio/fim dela, em vez do topo
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tab]);
  const headerRef = useRef(null);
  const navRef = useRef(null);
  const tabSlotRefs = useRef({});
  const [pilulaRect, setPilulaRect] = useState(null);
  // altura real da barra de cima/baixo — usado no Rastreio pra empurrar os controles
  // do mapa pra fora da faixa que fica por baixo delas (que agora é semitransparente)
  const [chromeHeights, setChromeHeights] = useState({ header: 64, nav: 76 });

  useEffect(() => {
    const medir = () => {
      setChromeHeights({
        header: headerRef.current?.offsetHeight || 64,
        nav: navRef.current?.offsetHeight || 76,
      });
    };
    medir();
    const ro = new ResizeObserver(medir);
    if (headerRef.current) ro.observe(headerRef.current);
    if (navRef.current) ro.observe(navRef.current);
    window.addEventListener("resize", medir);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", medir);
    };
  }, []);

  const motosState = useSharedList("mobirelli-motos");
  const clientesState = useSharedList("mobirelli-clientes");
  const fluxoState = useSharedList("mobirelli-fluxo-caixa");
  const futurosState = useSharedList("mobirelli-fluxo-futuro");
  const configState = useSharedObject("mobirelli-config", {});

  // mesma lógica pras permissões — "visualizador" nunca pode criar/editar/excluir nada,
  // só o "admin" mexe em usuários. A trava de verdade fica no RLS do Supabase (schema.sql);
  // isso aqui só evita mostrar botão de ação pra quem não pode usar
  permissoes.podeEditar = perfil?.role === "admin" || perfil?.role === "editor";
  permissoes.podeGerenciarUsuarios = perfil?.role === "admin";

  // cobre a área que aparece durante o "elástico" do scroll (Mac) — sem isso, dava pra
  // ver o fundo padrão (branco) do navegador atrás do site ao arrastar além do topo/fim
  useEffect(() => {
    document.documentElement.style.backgroundColor = theme.bg;
    document.body.style.backgroundColor = theme.bg;
  }, [theme.bg]);

  const loading = motosState.loading || clientesState.loading || fluxoState.loading || configState.loading;
  const anyError = motosState.error || clientesState.error || fluxoState.error || configState.error;

  // carrega os dados da planilha sozinho, uma vez, sem precisar de nenhum botão —
  // cada lista só é preenchida se ainda estiver vazia (não sobrescreve o que já foi editado)
  useEffect(() => {
    if (!motosState.loading && motosState.items.length === 0) motosState.persist(SEED_MOTOS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motosState.loading]);
  useEffect(() => {
    if (!clientesState.loading && clientesState.items.length === 0) clientesState.persist(SEED_CLIENTES);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientesState.loading]);
  useEffect(() => {
    if (!fluxoState.loading && fluxoState.items.length === 0) fluxoState.persist(SEED_FLUXO);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fluxoState.loading]);

  const tabs = [
    { id: "dashboard", label: "Início", icon: LayoutDashboard },
    { id: "motos", label: "Motos", icon: Bike },
    { id: "clientes", label: "Clientes", icon: Users },
    { id: "fluxo", label: "Caixa", icon: Wallet },
    { id: "rastreio", label: "Rastreio", icon: Navigation },
    { id: "config", label: "Ajustes", icon: Settings },
  ];

  // mede a posição do ícone da aba ativa pra "pílula" verde deslizar até ali (em vez de
  // simplesmente aparecer/desaparecer em cada aba) — precisa medir de novo sempre que a
  // aba muda ou a tela redimensiona, já que os botões são distribuídos com flex
  useEffect(() => {
    const medir = () => {
      const slot = tabSlotRefs.current[tab];
      const navEl = navRef.current;
      if (!slot || !navEl) return;
      const slotRect = slot.getBoundingClientRect();
      const navRect = navEl.getBoundingClientRect();
      setPilulaRect({ left: slotRect.left - navRect.left, top: slotRect.top - navRect.top, width: slotRect.width, height: slotRect.height });
    };
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, [tab]);

  // arrastar a pílula pro lado troca de aba também, igual num seletor de segmentos do
  // iOS — guarda o centro de cada aba (medido só uma vez, no início do arrasto) pra achar
  // qual fica mais perto do dedo quando soltar
  const dragInfoRef = useRef(null);
  const dragLeftRef = useRef(null);
  const [arrastando, setArrastando] = useState(false);
  const [dragLeft, setDragLeft] = useState(null);

  const iniciarArrasto = (e) => {
    const navEl = navRef.current;
    if (!navEl || !pilulaRect) return;
    const navRect = navEl.getBoundingClientRect();
    const centros = tabs.map((t) => {
      const el = tabSlotRefs.current[t.id];
      const r = el.getBoundingClientRect();
      return { id: t.id, center: r.left - navRect.left + r.width / 2 };
    });
    dragInfoRef.current = { startClientX: e.clientX, startLeft: pilulaRect.left, centros, maxLeft: navRect.width - pilulaRect.width };
    dragLeftRef.current = pilulaRect.left;
    setArrastando(true);
    setDragLeft(pilulaRect.left);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const moverArrasto = (e) => {
    const info = dragInfoRef.current;
    if (!info) return;
    const delta = e.clientX - info.startClientX;
    const novo = Math.max(0, Math.min(info.maxLeft, info.startLeft + delta));
    dragLeftRef.current = novo;
    setDragLeft(novo);
  };

  const soltarArrasto = () => {
    const info = dragInfoRef.current;
    if (!info) return;
    const centroAtual = (dragLeftRef.current ?? info.startLeft) + pilulaRect.width / 2;
    let maisProximo = info.centros[0];
    let menorDist = Infinity;
    info.centros.forEach((c) => {
      const d = Math.abs(c.center - centroAtual);
      if (d < menorDist) {
        menorDist = d;
        maisProximo = c;
      }
    });
    dragInfoRef.current = null;
    dragLeftRef.current = null;
    setDragLeft(null);
    setArrastando(false);
    if (maisProximo.id !== tab) setTab(maisProximo.id);
  };

  return (
    <div
      style={{
        backgroundColor: theme.bg,
        backgroundImage: `radial-gradient(circle at 12% -8%, ${theme.mint}12 0%, transparent 38%), radial-gradient(circle at 50% 115%, ${theme.amber}0A 0%, transparent 36%)`,
        backgroundAttachment: "fixed",
        minHeight: "100vh",
        fontFamily: BODY_FONT,
      }}
    >
      <style>{`
        ${fontImport}
        * { -webkit-tap-highlight-color: transparent; }
        button { transition: opacity 0.15s ease, transform 0.16s ease, filter 0.15s ease; cursor: pointer; }
        button:active { transform: scale(0.97); opacity: 0.85; }
        .mbr-hover-grow { transform-origin: center; }
        .mbr-tab-icon { transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1); }
        .mbr-card-lift { transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.28s ease; will-change: transform; }
        @media (hover: hover) and (pointer: fine) {
          button:hover { filter: brightness(1.22); }
          nav button:hover { filter: none; transform: translateY(-2px); }
          nav button:hover span:first-child { background: ${hexToRgba(theme.mint, 0.1)}; }
          nav button:hover .mbr-tab-icon { transform: scale(1.2) rotate(-6deg); }
          .mbr-hover-grow:hover { transform: scale(1.16); filter: brightness(1.28); }
          .mbr-card-lift:hover { transform: translateY(-1px); box-shadow: 0 4px 14px rgba(0,0,0,0.24); }
        }
        input, select, textarea, button { font-family: ${BODY_FONT}; }
        input:focus, select:focus, textarea:focus, button:focus-visible {
          outline: 2px solid ${theme.mint}; outline-offset: 1px;
        }
        @media (prefers-reduced-motion: reduce) {
          * { transition: none !important; animation: none !important; }
        }
        @keyframes mbrPulse { 0%, 100% { opacity: 0.45; } 50% { opacity: 0.9; } }
        .mbr-skel { animation: mbrPulse 1.3s ease-in-out infinite; border-radius: 10px; background: ${theme.card}; }
        @keyframes mbrFadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .mbr-fade-in { animation: mbrFadeIn 0.24s ease both; }
        @keyframes mbrRotuloTroca { from { opacity: 0; } to { opacity: 1; } }
        .mbr-rotulo-troca { animation: mbrRotuloTroca 0.22s ease both; animation-delay: 0.08s; }
      `}</style>

      <header
        ref={headerRef}
        className="px-4 sm:px-8 py-3 grid items-center sticky top-0 z-40"
        style={{
          gridTemplateColumns: "1fr auto 1fr",
          paddingTop: "calc(0.75rem + env(safe-area-inset-top, 0px))",
          background:
            tab === "rastreio"
              ? `linear-gradient(to bottom, ${hexToRgba(theme.panel, 0.9)} 0%, ${hexToRgba(theme.panel, 0.9)} 50%, ${hexToRgba(theme.panel, 0)} 100%)`
              : hexToRgba(theme.panel, 0.82),
          borderBottom: tab === "rastreio" ? "none" : `1px solid ${theme.divider}`,
          backdropFilter: tab === "rastreio" ? "none" : "saturate(1.6) blur(16px)",
          WebkitBackdropFilter: tab === "rastreio" ? "none" : "saturate(1.6) blur(16px)",
        }}
      >
        {tab === "rastreio" && <BorraProgressiva lado="topo" />}
        <div />
        <div className="flex justify-center">
          <Wordmark logoDataUrl={configState.value.logoDataUrl} logoSize={configState.value.logoSize} />
        </div>
        <div className="flex justify-end">
          {anyError && (
            <span className="text-xs" style={{ color: theme.coral, fontFamily: BODY_FONT }}>
              {anyError}
            </span>
          )}
        </div>
      </header>

      {versaoNovaDisponivel && (
        // a centralização (translateX) fica num wrapper parado — a classe mbr-fade-in
        // anima "transform" (translateY) no elemento visível de dentro; se as duas
        // ficassem no mesmo elemento, a animação substituiria o translateX inteiro,
        // e o aviso nascia desalinhado, saindo da tela
        <div className="fixed left-1/2 z-50" style={{ top: "calc(env(safe-area-inset-top, 0px) + 10px)", transform: "translateX(-50%)" }}>
          <div
            className="flex items-center gap-2 rounded-xl px-3 py-2 mbr-fade-in"
            style={{
              width: "calc(100vw - 32px)",
              maxWidth: 340,
              background: theme.mint,
              color: theme.mintText,
              boxShadow: "0 4px 20px rgba(0,0,0,0.35)",
              fontFamily: BODY_FONT,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <span className="truncate" style={{ flex: "1 1 auto", minWidth: 0 }}>
              Versão nova disponível
            </span>
            <button
              onClick={() => window.location.reload()}
              className="rounded-lg px-2.5 py-1 text-xs font-bold flex-shrink-0"
              style={{ background: theme.mintText, color: theme.mint }}
            >
              Atualizar
            </button>
          </div>
        </div>
      )}

      <main
        className={tab === "rastreio" ? "" : "px-4 sm:px-8 pt-5 max-w-5xl mx-auto lg:max-w-7xl"}
        style={
          tab === "rastreio"
            ? { position: "fixed", inset: 0, overflow: "hidden", zIndex: 0 }
            : { paddingBottom: "calc(84px + env(safe-area-inset-bottom, 0px))" }
        }
      >
        {loading ? (
          <div className="flex flex-col gap-3">
            <div className="mbr-skel" style={{ height: 90 }} />
            <div className="grid grid-cols-2 gap-3">
              <div className="mbr-skel" style={{ height: 70 }} />
              <div className="mbr-skel" style={{ height: 70 }} />
            </div>
            <div className="mbr-skel" style={{ height: 220 }} />
          </div>
        ) : (
          <div key={tab} className="mbr-fade-in" style={tab === "rastreio" ? { height: "100%" } : undefined}>
            {tab === "dashboard" ? (
              <DashboardView motos={motosState.items} lancamentos={fluxoState.items} clientes={clientesState.items} futuros={futurosState.items} />
            ) : tab === "motos" ? (
              <MotosView
                motos={motosState.items}
                persist={motosState.persist}
                clientes={clientesState.items}
                persistClientes={clientesState.persist}
                config={configState.value}
                lancamentos={fluxoState.items}
                persistLancamentos={fluxoState.persist}
              />
            ) : tab === "clientes" ? (
              <ClientesView
                clientes={clientesState.items}
                persistClientes={clientesState.persist}
                motos={motosState.items}
                persistMotos={motosState.persist}
              />
            ) : tab === "fluxo" ? (
              <FluxoCaixaView
                lancamentos={fluxoState.items}
                persist={fluxoState.persist}
                motos={motosState.items}
                clientes={clientesState.items}
                futuros={futurosState.items}
                persistFuturos={futurosState.persist}
              />
            ) : tab === "rastreio" ? (
              <RastreioView
                config={configState.value}
                motos={motosState.items}
                clientes={clientesState.items}
                topInset={chromeHeights.header}
                bottomInset={chromeHeights.nav}
              />
            ) : (
              <ConfiguracoesView config={configState.value} persist={configState.persist} perfil={perfil} onSignOut={onSignOut} />
            )}
          </div>
        )}
      </main>

      <nav
        ref={navRef}
        className="fixed bottom-0 left-0 right-0 z-40 flex items-stretch justify-around px-2 py-1.5"
        style={{
          background:
            tab === "rastreio"
              ? `linear-gradient(to bottom, ${hexToRgba(theme.panel, 0)} 0%, ${hexToRgba(theme.panel, 0.9)} 50%, ${hexToRgba(theme.panel, 0.9)} 100%)`
              : hexToRgba(theme.panel, 0.82),
          borderTop: tab === "rastreio" ? "none" : `1px solid ${theme.divider}`,
          paddingBottom: "calc(6px + env(safe-area-inset-bottom, 0px))",
          backdropFilter: tab === "rastreio" ? "none" : "saturate(1.6) blur(16px)",
          WebkitBackdropFilter: tab === "rastreio" ? "none" : "saturate(1.6) blur(16px)",
        }}
      >
        {tab === "rastreio" && <BorraProgressiva lado="base" />}
        {pilulaRect && (
          <span
            onPointerDown={iniciarArrasto}
            onPointerMove={moverArrasto}
            onPointerUp={soltarArrasto}
            onPointerCancel={soltarArrasto}
            className="absolute rounded-full"
            style={{
              left: 0,
              top: pilulaRect.top,
              width: pilulaRect.width,
              height: pilulaRect.height,
              background: hexToRgba(theme.mint, 0.16),
              zIndex: -1,
              cursor: "grab",
              touchAction: "none",
              willChange: "transform",
              // transform em vez de "left" — anima só na composição da GPU, sem
              // recalcular layout a cada quadro, então fica fluido em qualquer taxa de
              // atualização da tela (inclusive 120Hz), em vez de travar feito antes
              transform: `translateX(${(arrastando ? dragLeft : pilulaRect.left) ?? 0}px)`,
              transition: arrastando ? "none" : "transform 0.28s cubic-bezier(0.32, 0.72, 0, 1)",
            }}
          />
        )}
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-label={t.label}
              title={t.label}
              className="flex-1 flex items-center justify-center py-1.5"
              style={{
                color: active ? theme.mint : theme.textGhost,
                background: "none",
                transition: "color 0.15s ease, transform 0.18s ease",
                // na aba ativa, o botão "cede o lugar" pra pílula (que fica embaixo dele
                // nessa mesma área) poder receber o toque/arrasto — clicar nela de
                // qualquer jeito não faria nada, já que é a aba em que já se está
                pointerEvents: active ? "none" : "auto",
              }}
            >
              <span
                ref={(el) => (tabSlotRefs.current[t.id] = el)}
                className="relative rounded-full flex items-center justify-center"
                style={{ width: 44, height: 44, zIndex: 1 }}
              >
                <Icon size={24} strokeWidth={active ? 2.4 : 2} className="mbr-tab-icon" />
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

/* ===========================================================
   RAIZ — decide entre a tela de carregando, "criar administrador" (só no
   primeiríssimo acesso, antes de existir qualquer login), a tela de login,
   ou o app de verdade. Fica fora de AppAutenticado de propósito: assim os
   hooks que buscam motos/clientes/caixa só disparam depois que a pessoa
   já está logada.
=========================================================== */
export default function MobirelliRoot() {
  const { session, perfil, loading, adminExiste } = useAuth();

  if (loading || adminExiste === null) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: theme.bg }}>
        <div className="mbr-skel" style={{ width: 160, height: 40, borderRadius: 12 }} />
      </div>
    );
  }

  if (!adminExiste) return <CriarAdminView />;
  if (!session || !perfil) return <LoginView />;

  return <AppAutenticado perfil={perfil} onSignOut={signOut} />;
}
