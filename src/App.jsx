import React, { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef, useId, forwardRef, useImperativeHandle } from "react";
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
// Paleta antiga do site, agora REMAPEADA pra paleta do redesign (os mesmos valores
// dos tokens --rd-* de index.css, em hex porque hexToRgba()/mixColors() precisam de
// hex de verdade, não de var(--...)).
//
// Por que remapear em vez de trocar tela por tela: tudo que ainda não foi reescrito
// no design novo (os 11 modais, as fichas expandidas de moto e de cliente, a tela de
// login) lê estas chaves. Mudando aqui, essa superfície inteira passa a falar a mesma
// língua visual do resto — em vez de o site ter metade numa estética e metade noutra.
const theme = {
  bg: "#0E1512",          // --rd-shell
  panel: "#141B16",       // --rd-surface
  card: "#141B16",        // --rd-surface
  card2: "#0F1712",       // --rd-surface-2
  cardBorder: "#26352C",  // --rd-border (no design novo o cartão TEM borda fina)
  divider: "#1A2620",     // --rd-row-border
  mint: "#8AA981",        // --rd-brand-soft — fundo de botão primário
  mintText: "#0E1512",    // --rd-shell — texto POR CIMA do verde claro
  sage: "#A8C79E",        // --rd-brand-light
  amber: "#C68A3A",       // --rd-attention
  coral: "#D9705C",       // --rd-negative
  text: "#E8EDE7",        // --rd-text
  textMuted: "#A9B8AB",   // --rd-text-muted
  textFaint: "#7C8C7E",   // --rd-text-dim
  textGhost: "#5E6F61",   // --rd-text-faint
  outline: "#26352C",     // --rd-border
  outlineText: "#A9B8AB", // --rd-text-muted
  chartMuted: "#5E6F61",  // --rd-text-faint
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
// O site inteiro usa uma fonte só (Montserrat, a do redesign) — o que separa título de
// texto é peso e tamanho, não família. HEAD_FONT/BODY_FONT continuam existindo porque
// meio site ainda os cita; agora os dois apontam pra mesma pilha, então não sobra
// nenhum pedaço da interface escrito na fonte antiga.
const HEAD_FONT = "'Montserrat', -apple-system, BlinkMacSystemFont, system-ui, sans-serif";
const BODY_FONT = "'Montserrat', -apple-system, BlinkMacSystemFont, system-ui, sans-serif";
const MONO_FONT = "ui-monospace, SFMono-Regular, Menlo, monospace";

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
function contratosComoFuturos(motos) {
  return (motos || [])
    .filter((m) => m.contratoAtual && Number(m.contratoAtual.valorMensal) > 0)
    .map((m) => ({
      id: `contrato-${m.contratoAtual.id}`,
      tipo: "entrada",
      descricao: `Mensalidade ${formatPlaca(m.placa)}`,
      categoria: "Contrato ativo",
      valor: Number(m.contratoAtual.valorMensal) || 0,
      vencimento: m.contratoAtual.dataInicio || todayISO(),
      diaVencimento: diaVencimentoDoContrato(m.contratoAtual),
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

// vencido = já passou o dia de pagamento deste mês E ainda não tem nenhuma entrada
// lançada no caixa pra essa moto depois desse vencimento — sem o segundo pedaço, o
// pagamento continuava aparecendo como atrasado mesmo depois de lançado no Caixa
const isContratoVencido = (contrato, pagamentos) => {
  const dia = diaVencimentoDoContrato(contrato);
  if (!dia) return false;
  const hoje = new Date();
  const hojeZero = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  // a primeira cobrança só vence um mês depois do início do contrato — no mês em que o
  // cliente começa a usar a moto ele ainda não paga nada, então não pode aparecer como
  // atrasado antes do dia de cobrança do mês SEGUINTE ao início
  if (contrato.dataInicio) {
    const [anoInicio, mesInicio] = contrato.dataInicio.split("-").map(Number);
    if (anoInicio && mesInicio) {
      const primeiroVencimento = new Date(anoInicio, mesInicio, dia); // mês seguinte (mesInicio já é 1-based)
      if (hojeZero < primeiroVencimento) return false;
    }
  }
  const vencimentoDoMes = new Date(hoje.getFullYear(), hoje.getMonth(), dia);
  if (hojeZero <= vencimentoDoMes) return false;
  const vencimentoISO = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  const jaPagou = (pagamentos || []).some((p) => p.data >= vencimentoISO);
  return !jaPagou;
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
/* ===========================================================
   REDESIGN — marca compacta do shell novo (Etapa 2). Ícone das "duas rodas"
   copiado à risca do mockup exportado do Claude Design. A logo própria
   configurável foi removida (ver Ajustes) — a marca do shell é fixa.
=========================================================== */
function MarcaMobirelli({ size = 38, raio = 11 }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: raio,
        background: "var(--rd-brand)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
      }}
    >
      <svg width={size * 0.66} viewBox="0 0 60 34" fill="none">
        <circle cx="12" cy="22" r="8" stroke="#F4F2EA" strokeWidth="4.5" />
        <circle cx="48" cy="22" r="8" stroke="#F4F2EA" strokeWidth="4.5" />
        <path d="M12 22 L26 9 H38 L48 22" stroke="#8AA981" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function LinhaMarca() {
  return (
    <span className="flex items-center" style={{ width: 64 }}>
      <span style={{ height: 2.5, background: "var(--rd-brand-soft)", borderRadius: 2, flex: 1 }} />
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          border: "1.6px solid var(--rd-brand-soft)",
          background: "var(--rd-sidebar)",
          boxSizing: "border-box",
          flex: "none",
          marginLeft: -1.6,
        }}
      />
    </span>
  );
}

function AvatarIniciais({ username }) {
  const iniciais = (username || "").trim().slice(0, 2).toUpperCase() || "??";
  return (
    <div
      style={{
        width: 30,
        height: 30,
        borderRadius: 999,
        background: "#2A3A2F",
        color: "var(--rd-brand-light)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 12,
        fontWeight: 700,
        flex: "none",
      }}
    >
      {iniciais}
    </div>
  );
}

function MotoPlate({ placa, size = "normal" }) {
  const grande = size === "grande";
  return (
    <div
      style={{
        background: "var(--rd-brand)",
        borderRadius: 999,
        padding: grande ? "6px 15px" : "3px 10px",
        display: "inline-flex",
        alignItems: "center",
      }}
    >
      <span
        style={{
          fontFamily: "ui-monospace, monospace",
          fontWeight: 700,
          letterSpacing: grande ? 1.5 : 0.5,
          fontSize: grande ? 19 : 11.5,
          color: "var(--rd-brand-light)",
        }}
      >
        {placa ? formatPlaca(placa) : "SEM PLACA"}
      </span>
    </div>
  );
}

const MOTO_STATUS = {
  disponivel: { label: "Disponível", color: "#C68A3A", dark: true, icon: CheckCircle2 },
  alugada: { label: "Alugada", color: "#8AA981", dark: true, icon: Bike },
  preparacao: { label: "Em preparação", color: "#A8C79E", dark: true, icon: Clock },
  manutencao: { label: "Em manutenção", color: "#D9705C", dark: true, icon: Wrench },
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
      style={{ background: "rgba(6,10,8,0.74)", opacity: visible ? 1 : 0, transition: "opacity 0.2s ease", zIndex: 999 }}
      onClick={handleClose}
    >
      <div
        className="w-full sm:max-w-md max-h-[92vh] overflow-y-auto mbr-modal-card"
        style={{
          background: "var(--rd-surface)",
          border: "1px solid var(--rd-border)",
          padding: "var(--rd-pad-card-y) var(--rd-pad-card-x) var(--rd-s6)",
          fontFamily: "var(--rd-font)",
          color: "var(--rd-text)",
          boxShadow: "0 -8px 34px rgba(0,0,0,0.34)",
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0) scale(1)" : "translateY(28px) scale(0.97)",
          transition: "transform 0.24s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.2s ease",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sm:hidden mx-auto rounded-full" style={{ width: 36, height: 5, marginBottom: "var(--rd-s3)", background: "var(--rd-border)" }} />
        <div className="flex items-center justify-between" style={{ gap: "var(--rd-s3)", marginBottom: "var(--rd-s5)" }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--rd-text)" }}>{title}</h3>
          <button
            onClick={handleClose}
            aria-label="Fechar"
            className="flex items-center justify-center flex-shrink-0"
            style={{ width: 32, height: 32, borderRadius: 999, background: "var(--rd-surface-2)", border: "1px solid var(--rd-border)", color: "var(--rd-text-muted)" }}
          >
            <X size={16} strokeWidth={2.5} />
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
    <label
      className="block"
      style={{
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: "var(--rd-text-faint)",
        fontFamily: "var(--rd-font)",
        marginBottom: 6,
      }}
    >
      {children}
    </label>
  );
}

const inputStyle = {
  width: "100%",
  background: "var(--rd-surface-2)",
  border: "1px solid var(--rd-border)",
  borderRadius: 12,
  padding: "10px 13px",
  color: "var(--rd-text)",
  fontFamily: "var(--rd-font)",
  fontSize: 13.5,
  marginBottom: 14,
};

// input[type=date] tem um controle nativo (o ícone do calendário) que o navegador
// desenha com um "box" próprio, maior que o de um input de texto comum, mesmo com o
// padding igual — height explícito força os dois a ficarem do mesmo tamanho
const dateInputStyle = { ...inputStyle, height: 43 };

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
  return <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: "var(--rd-s3)" }}>{children}</div>;
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
              style={{ background: theme.mint, color: theme.mintText, fontWeight: 600 }}
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
                  style={{ color: theme.textMuted, fontFamily: BODY_FONT, borderBottom: i < itens.length - 1 ? `1px solid ${theme.divider}` : "none" }}
                >
                  <span className="truncate">{it.label}</span>
                  <span style={{ fontWeight: 700, flexShrink: 0, color: it.cor || theme.text }}>{fmt(it.total)}</span>
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
      <button onClick={() => onSave(form)} className="w-full rounded-xl py-2 font-semibold mt-1" style={{ background: theme.mint, color: theme.mintText, fontWeight: 600 }}>
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
        style={{ background: theme.mint, color: theme.mintText, fontWeight: 600 }}
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
    <div className="flex flex-col" style={{ gap: "var(--rd-gap-secao)" }}>
      <div className="flex items-center flex-wrap" style={{ gap: "var(--rd-s4)" }}>
        <div className="flex flex-col" style={{ gap: 3 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--rd-text)", fontFamily: "var(--rd-font)" }}>Clientes</h1>
          <span style={{ fontSize: 12.5, color: "var(--rd-text-dim)" }}>
            {clientes.length} cliente{clientes.length === 1 ? "" : "s"} · {semMotoAgora} sem moto no momento
          </span>
        </div>
        {permissoes.podeEditar && (
          <button
            onClick={() => setModal({ mode: "novo", cliente: emptyCliente() })}
            className="flex items-center"
            style={{ gap: 8, marginLeft: "auto", background: "var(--rd-brand-soft)", color: "var(--rd-shell)", borderRadius: 999, padding: "10px 18px", fontSize: 13.5, fontWeight: 700 }}
          >
            <Plus size={15} strokeWidth={3} /> Novo cliente
          </button>
        )}
      </div>

      <div className="relative">
        <Search size={15} strokeWidth={2.75} style={{ position: "absolute", left: 14, top: 12, color: "var(--rd-text-dim)" }} />
        <input
          style={{
            width: "100%",
            background: "var(--rd-surface-2)",
            border: "1px solid var(--rd-border)",
            borderRadius: 12,
            padding: "10px 14px 10px 38px",
            color: "var(--rd-text)",
            fontSize: 13.5,
            fontFamily: "var(--rd-font)",
          }}
          placeholder="Buscar por nome ou CPF/CNPJ"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
      </div>

      {filtrados.length === 0 ? (
        <div className="rounded-2xl p-6 text-center" style={{ background: "var(--rd-surface)", border: "1px solid var(--rd-border)", color: "var(--rd-text-dim)", fontFamily: "var(--rd-font)" }}>
          Nenhum cliente encontrado.
        </div>
      ) : (
        <>
          <div className="mbr-desktop-grid mbr-tab-head mbr-grid-clientes">
            <span>Cliente</span>
            <span>CPF/CNPJ</span>
            <span>Contato</span>
            <span>Moto</span>
            <span></span>
          </div>

          <div className="flex flex-col" style={{ gap: 10 }}>
            {filtrados.map((c) => {
          const motoVinculada = motos.find((m) => m.contratoAtual?.clienteId === c.id);
          const aberto = expandido === c.id;
          return (
            <div key={c.id} className="rounded-2xl overflow-hidden" style={{ background: "var(--rd-surface)", border: "1px solid var(--rd-border)" }}>
              <button
                className="w-full text-left mbr-desktop-grid mbr-tab-row mbr-grid-clientes"
                onClick={() => setExpandido(aberto ? null : c.id)}
              >
                <div className="flex flex-col min-w-0" style={{ gap: 4 }}>
                  <span className="truncate" style={{ fontSize: 13.5, fontWeight: 600, color: "var(--rd-text)" }}>{c.nome || "Sem nome"}</span>
                  <span className="truncate" style={{ fontSize: 11.5, color: "var(--rd-text-dim)" }}>{[c.cidade, c.estado].filter(Boolean).join("/") || "—"}</span>
                </div>
                <span className="truncate" style={{ minWidth: 0, fontFamily: "ui-monospace, monospace", fontSize: 12.5, color: "var(--rd-text-muted)" }}>
                  {c.cpfCnpj || "—"}
                </span>
                <div className="flex flex-col min-w-0" style={{ gap: 4 }}>
                  <span className="truncate" style={{ fontSize: 12.5, color: "var(--rd-text-muted)" }}>{c.telefone || "—"}</span>
                  <span className="truncate" style={{ fontSize: 11.5, color: "var(--rd-text-dim)" }}>{c.email || ""}</span>
                </div>
                {motoVinculada ? (
                  <div className="flex items-center min-w-0" style={{ gap: 8 }}>
                    <span
                      style={{
                        fontFamily: "ui-monospace, monospace",
                        fontSize: 11.5,
                        fontWeight: 700,
                        color: "var(--rd-brand-light)",
                        background: "var(--rd-brand)",
                        borderRadius: 999,
                        padding: "3px 9px",
                      }}
                    >
                      {formatPlaca(motoVinculada.placa)}
                    </span>
                    <span style={{ fontSize: 11.5, color: "var(--rd-text-dim)" }}>{formatCurrency(motoVinculada.contratoAtual.valorMensal)}</span>
                  </div>
                ) : (
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--rd-attention-text)" }}>Sem moto no momento</span>
                )}
                <span style={{ fontSize: 12.5, fontWeight: 700, color: motoVinculada ? "var(--rd-brand-light)" : "var(--rd-attention)", justifySelf: "end" }}>
                  {aberto ? "Fechar" : motoVinculada ? "Abrir" : "Vincular"}
                </span>
              </button>

              <button
                className="w-full mbr-mobile-only flex items-center justify-between text-left"
                onClick={() => setExpandido(aberto ? null : c.id)}
                style={{ gap: 12, padding: "14px 16px" }}
              >
                <div className="flex items-center min-w-0" style={{ gap: 12 }}>
                  <div className="flex items-center justify-center flex-shrink-0" style={{ width: 32, height: 32, borderRadius: 9, background: "var(--rd-surface-2)" }}>
                    <Users size={16} color={motoVinculada ? "var(--rd-brand-light)" : "var(--rd-attention)"} />
                  </div>
                  <div className="flex flex-col min-w-0" style={{ gap: 3 }}>
                    <span className="truncate" style={{ fontSize: 13.5, fontWeight: 600, color: "var(--rd-text)" }}>{c.nome || "Sem nome"}</span>
                    <span className="truncate" style={{ fontSize: 11.5, color: "var(--rd-text-dim)" }}>
                      {motoVinculada ? `Com a moto ${formatPlaca(motoVinculada.placa)}` : "Sem moto no momento"}
                    </span>
                  </div>
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, color: motoVinculada ? "var(--rd-brand-light)" : "var(--rd-attention)", flex: "none" }}>
                  {aberto ? "Fechar" : motoVinculada ? "Abrir" : "Vincular"}
                </span>
              </button>

              <Collapse open={aberto}>
                <div
                  className="text-sm"
                  style={{
                    fontFamily: BODY_FONT,
                    // mesma calha lateral da linha fechada, pra ficha aberta e linha
                    // fechada compartilharem a mesma margem em vez de cada uma ter a sua
                    padding: "0 var(--rd-pad-row-x) var(--rd-s5)",
                    borderTop: "1px solid var(--rd-border-soft)",
                    paddingTop: "var(--rd-s5)",
                  }}
                >
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
                          style={{ background: theme.mint, color: theme.mintText, minHeight: 44 }}
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
        </>
      )}

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
      <button onClick={() => onSave(form)} className="w-full rounded-xl py-2 font-semibold mt-1" style={{ background: theme.mint, color: theme.mintText, fontWeight: 600 }}>
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
        style={{ background: theme.mint, color: theme.mintText, fontWeight: 600 }}
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
        style={{ background: theme.mint, color: theme.mintText, fontWeight: 600 }}
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
        style={{ background: theme.mint, color: theme.mintText, fontWeight: 600 }}
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
          style={{ background: theme.mint, color: theme.mintText, fontWeight: 600, opacity: status === "carregando" ? 0.6 : 1 }}
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

  const [filtroStatus, setFiltroStatus] = useState("todas"); // "todas" | "alugada" | "disponivel" | "manutencao"
  const contagemStatus = {
    alugada: motos.filter((m) => m.status === "alugada").length,
    disponivel: motos.filter((m) => m.status === "disponivel").length,
    manutencao: motos.filter((m) => m.status === "manutencao").length,
  };

  const filtradas = motos.filter((m) => {
    const q = busca.toLowerCase();
    const qLimpo = placaLimpa(busca).toLowerCase();
    const bateBusca =
      !q ||
      [m.placa, m.chassi, m.renavam, m.modelo].some((f) => f?.toLowerCase().includes(q)) ||
      (qLimpo && m.placa?.toLowerCase().includes(qLimpo));
    const bateStatus = filtroStatus === "todas" || m.status === filtroStatus;
    return bateBusca && bateStatus;
  });

  // alugadas primeiro (por vencimento mais próximo), paradas/manutenção por último
  const linhas = [...filtradas].sort((a, b) => {
    const alugadaA = a.status === "alugada" ? 0 : 1;
    const alugadaB = b.status === "alugada" ? 0 : 1;
    if (alugadaA !== alugadaB) return alugadaA - alugadaB;
    const diaA = diaVencimentoDoContrato(a.contratoAtual) ?? 99;
    const diaB = diaVencimentoDoContrato(b.contratoAtual) ?? 99;
    return diaA - diaB;
  });

  const mesesDesde = (dataISO) => {
    if (!dataISO) return null;
    const d = new Date(`${dataISO}T00:00:00`);
    const hoje = new Date();
    return Math.max(0, (hoje.getFullYear() - d.getFullYear()) * 12 + (hoje.getMonth() - d.getMonth()));
  };

  const paybackDaMoto = (m) => {
    const custosExtrasTotal = custosDaMoto(m, lancamentos).reduce((s, c) => s + Number(c.valorGasto || 0), 0);
    const manutencaoTotal = (m.manutencoes || []).reduce((s, x) => s + Number(x.valorGasto || 0), 0);
    const investimentoTotal = Number(m.valorCompra || 0) + custosExtrasTotal + manutencaoTotal;
    const recebidoReal = pagamentosDaMoto(m, lancamentos).reduce((s, p) => s + Number(p.valor), 0);
    return investimentoTotal > 0 ? Math.min(100, (recebidoReal / investimentoTotal) * 100) : 0;
  };

  const diasParadaDaMoto = (m) => {
    const historico = [...(m.historicoContratos || [])].sort((a, b) => (a.encerradoEm > b.encerradoEm ? -1 : 1));
    const desde = historico[0]?.encerradoEm || m.dataCompra;
    if (!desde) return null;
    const inicio = new Date(`${desde}T00:00:00`);
    return Math.max(0, Math.floor((new Date() - inicio) / (1000 * 60 * 60 * 24)));
  };

  const clientesSemContrato = clientes.filter((c) => !motos.some((mm) => mm.contratoAtual?.clienteId === c.id));

  const filtros = [
    { id: "todas", label: "Todas" },
    { id: "alugada", label: "Alugadas" },
    { id: "disponivel", label: `Paradas${contagemStatus.disponivel ? ` ${contagemStatus.disponivel}` : ""}` },
    { id: "manutencao", label: "Manutenção" },
  ];

  return (
    <div className="flex flex-col" style={{ gap: "var(--rd-gap-secao)" }}>
      {/* linha 1 — só título e ações. Os filtros saíram daqui: com título,
          filtros e dois botões na mesma linha, o topo virava um amontoado */}
      <div className="flex items-center flex-wrap" style={{ gap: "var(--rd-s4)" }}>
        <div className="flex flex-col" style={{ gap: 3 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--rd-text)", fontFamily: "var(--rd-font)" }}>Frota</h1>
          <span style={{ fontSize: 12.5, color: "var(--rd-text-dim)" }}>
            {motos.length} moto{motos.length === 1 ? "" : "s"} · {contagemStatus.alugada} alugada{contagemStatus.alugada === 1 ? "" : "s"} ·{" "}
            {contagemStatus.disponivel} parada{contagemStatus.disponivel === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex items-center" style={{ gap: "var(--rd-s2)", marginLeft: "auto" }}>
          <button
            onClick={() => setModal({ type: "consulta" })}
            className="flex items-center"
            style={{
              gap: 8,
              background: "var(--rd-surface-2)",
              border: "1px solid var(--rd-border)",
              color: "var(--rd-text-muted)",
              borderRadius: 999,
              padding: "9px 16px",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            <Search size={14} strokeWidth={2.75} /> Consultar placa
          </button>
          {permissoes.podeEditar && (
            <button
              onClick={() => setModal({ type: "moto", mode: "novo", moto: emptyMoto() })}
              className="flex items-center"
              style={{ gap: 8, background: "var(--rd-brand-soft)", color: "var(--rd-shell)", borderRadius: 999, padding: "10px 18px", fontSize: 13.5, fontWeight: 700 }}
            >
              <Plus size={15} strokeWidth={3} /> Nova moto
            </button>
          )}
        </div>
      </div>

      {/* linha 2 — busca e filtros, o "painel de garimpo" da tela */}
      <div className="flex items-center flex-wrap" style={{ gap: "var(--rd-s3)" }}>
        <div className="relative" style={{ flex: "1 1 240px", minWidth: 0 }}>
          <Search size={15} strokeWidth={2.75} style={{ position: "absolute", left: 14, top: 12, color: "var(--rd-text-dim)" }} />
          <input
            style={{
              width: "100%",
              background: "var(--rd-surface-2)",
              border: "1px solid var(--rd-border)",
              borderRadius: 12,
              padding: "10px 14px 10px 38px",
              color: "var(--rd-text)",
              fontSize: 13.5,
              fontFamily: "var(--rd-font)",
            }}
            placeholder="Buscar por placa, chassi, renavam ou modelo"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <div className="mbr-filtros" style={{ flex: "0 1 auto", minWidth: 0 }}>
          {filtros.map((f) => (
            <button
              key={f.id}
              onClick={() => setFiltroStatus(f.id)}
              style={{
                padding: "6px 14px",
                borderRadius: 999,
                fontSize: 12.5,
                fontWeight: filtroStatus === f.id ? 700 : 600,
                background: filtroStatus === f.id ? "var(--rd-brand)" : "transparent",
                color: filtroStatus === f.id ? "#F0F5EE" : f.id === "disponivel" ? "var(--rd-attention)" : "var(--rd-text-dim)",
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {linhas.length === 0 ? (
        <div className="rounded-2xl p-6 text-center" style={{ background: "var(--rd-surface)", border: "1px solid var(--rd-border)", color: "var(--rd-text-dim)", fontFamily: "var(--rd-font)" }}>
          Nenhuma moto encontrada.
        </div>
      ) : (
        <>
          {/* cabeçalho da tabela — só desktop/tablet (>=1024px); no celular vira cartão por moto */}
          <div className="mbr-desktop-grid mbr-tab-head mbr-grid-frota">
            <span>Placa</span>
            <span>Cliente</span>
            <span>Mensalidade</span>
            <span>Vencimento</span>
            <span>Payback</span>
            <span className="mbr-col-extra">Onde está</span>
            <span></span>
          </div>

          <div className="flex flex-col" style={{ gap: 10 }}>
            {linhas.map((moto) => {
          const pagamentos = pagamentosDaMoto(moto, lancamentos);
          const vencido = moto.status === "alugada" && isContratoVencido(moto.contratoAtual, pagamentos);
          const cliente = clientes.find((c) => c.id === moto.contratoAtual?.clienteId);
          const aberto = expandido === moto.id;
          const diaVenc = diaVencimentoDoContrato(moto.contratoAtual);
          const payback = paybackDaMoto(moto);
          const parada = moto.status !== "alugada";
          const dias = parada ? diasParadaDaMoto(moto) : null;
          return (
            <div key={moto.id} className="rounded-2xl overflow-hidden" style={{ background: parada && moto.status === "disponivel" ? "#15120C" : "var(--rd-surface)", border: "1px solid var(--rd-border)" }}>
              <button
                className="w-full text-left mbr-desktop-grid mbr-tab-row mbr-grid-frota"
                onClick={() => setExpandido(aberto ? null : moto.id)}
              >
                <div className="flex flex-col" style={{ gap: 5 }}>
                  <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 13.5, fontWeight: 600, color: "var(--rd-text)" }}>{formatPlaca(moto.placa)}</span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      alignSelf: "flex-start",
                      borderRadius: 999,
                      padding: "2px 9px",
                      color: parada ? "var(--rd-attention)" : "var(--rd-brand-light)",
                      background: parada ? "#2A2115" : "var(--rd-brand)",
                    }}
                  >
                    {parada ? `${MOTO_STATUS[moto.status]?.label || "Parada"}${dias != null ? ` ${dias}d` : ""}` : "Alugada"}
                  </span>
                </div>
                <div className="flex flex-col min-w-0" style={{ gap: 3 }}>
                  {cliente ? (
                    <>
                      <span className="truncate" style={{ fontSize: 13.5, fontWeight: 600, color: "var(--rd-text)" }}>{cliente.nome}</span>
                      {moto.contratoAtual?.dataInicio ? (
                        <span style={{ fontSize: 11.5, color: "var(--rd-text-dim)" }}>
                          desde {formatDate(moto.contratoAtual.dataInicio)} · {mesesDesde(moto.contratoAtual.dataInicio)} mes
                          {mesesDesde(moto.contratoAtual.dataInicio) === 1 ? "" : "es"}
                        </span>
                      ) : (
                        <span style={{ fontSize: 11.5, color: "var(--rd-text-dim)" }}>data de início não informada</span>
                      )}
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--rd-attention-text)" }}>Sem contrato</span>
                      <span style={{ fontSize: 11.5, color: "var(--rd-attention-text)" }}>
                        {clientesSemContrato.length > 0 ? `${clientesSemContrato.length} na fila de espera` : "nenhum cliente na fila"}
                      </span>
                    </>
                  )}
                </div>
                <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--rd-text)" }}>
                  {moto.contratoAtual ? formatCurrency(moto.contratoAtual.valorMensal) : "—"}
                </span>
                {moto.contratoAtual ? (
                  <div className="flex flex-col" style={{ gap: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: vencido ? "var(--rd-negative)" : "var(--rd-text)" }}>
                      {diaVenc ? `dia ${diaVenc}` : "—"}
                    </span>
                    <span style={{ fontSize: 11.5, color: vencido ? "var(--rd-negative)" : "var(--rd-text-dim)" }}>{vencido ? "atrasado" : "em dia"}</span>
                  </div>
                ) : (
                  <span style={{ fontSize: 13, color: "var(--rd-text-dim)" }}>—</span>
                )}
                <div className="flex items-center" style={{ gap: 10, minWidth: 0 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <BarraComCometa pct={payback} color={payback >= 50 ? "var(--rd-positive)" : payback >= 15 ? "var(--rd-attention)" : "var(--rd-negative)"} />
                  </div>
                  <span style={{ fontSize: 11.5, color: "var(--rd-text-dim)", flex: "none" }}>{payback.toFixed(0)}%</span>
                </div>
                <div className="flex items-center mbr-col-extra" style={{ gap: 7, minWidth: 0 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 999, background: parada ? "var(--rd-attention)" : "var(--rd-positive)", flex: "none" }} />
                  <span className="truncate" style={{ fontSize: 12.5, color: "var(--rd-text-muted)" }}>
                    {parada ? "Pátio" : [cliente?.cidade, cliente?.estado].filter(Boolean).join("/") || "—"}
                  </span>
                </div>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: parada ? "var(--rd-attention)" : "var(--rd-brand-light)", justifySelf: "end" }}>
                  {aberto ? "Fechar" : parada ? "Alugar" : "Abrir"}
                </span>
              </button>

              {/* cartão — só celular/tablet (<1024px) */}
              <button className="w-full mbr-mobile-only flex items-center justify-between text-left" onClick={() => setExpandido(aberto ? null : moto.id)} style={{ gap: 12, padding: "14px 16px" }}>
                <div className="flex items-center min-w-0" style={{ gap: 12 }}>
                  <div className="flex items-center justify-center flex-shrink-0" style={{ width: 32, height: 32, borderRadius: 9, background: "var(--rd-surface-2)" }}>
                    <Bike size={16} color={vencido ? "var(--rd-negative)" : parada ? "var(--rd-attention)" : "var(--rd-brand-light)"} />
                  </div>
                  <div className="flex flex-col min-w-0" style={{ gap: 3 }}>
                    <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 13.5, fontWeight: 600, color: "var(--rd-text)" }}>{formatPlaca(moto.placa)}</span>
                    <span className="truncate" style={{ fontSize: 11.5, color: "var(--rd-text-dim)" }}>{cliente?.nome || "Sem contrato"}</span>
                  </div>
                </div>
                <div className="flex items-center flex-shrink-0" style={{ gap: 8 }}>
                  {vencido && <AlertTriangle size={14} color="var(--rd-negative)" />}
                  <span style={{ fontSize: 12, fontWeight: 700, color: parada ? "var(--rd-attention)" : "var(--rd-brand-light)" }}>
                    {aberto ? "Fechar" : parada ? "Alugar" : "Abrir"}
                  </span>
                </div>
              </button>

              <Collapse open={aberto}>
                <div
                  className="text-sm"
                  style={{
                    fontFamily: BODY_FONT,
                    // mesma calha lateral da linha fechada, pra ficha aberta e linha
                    // fechada compartilharem a mesma margem em vez de cada uma ter a sua
                    padding: "0 var(--rd-pad-row-x) var(--rd-s5)",
                    borderTop: "1px solid var(--rd-border-soft)",
                    paddingTop: "var(--rd-s5)",
                  }}
                >
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
                          <div className="flex items-center gap-1.5 mb-2" style={{ color: theme.coral, fontSize: 12, fontWeight: 600 }}>
                            <AlertTriangle size={13} /> Pagamento atrasado
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
                          style={{ background: theme.mint, color: theme.mintText, minHeight: 44 }}
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
                        Nenhum pagamento com "{formatPlaca(moto.placa)}" na categoria/descrição ainda.
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
        </>
      )}

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
          {(motos || []).length > 0 && (
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
          style={{ background: theme.mint, color: theme.mintText, fontWeight: 600 }}
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
          style={{ background: theme.mint, color: theme.mintText, fontWeight: 600 }}
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

const FuturosView = forwardRef(function FuturosView({ futuros, persist, motos, clientes, onConfirmar, mesAtualKey }, ref) {
  const [modal, setModal] = useState(null);
  const [verTodasCobrancas, setVerTodasCobrancas] = useState(false);
  const [verTodosFixos, setVerTodosFixos] = useState(false);
  const [verTodosAvulsos, setVerTodosAvulsos] = useState(false);
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
  const cobrancasPorDia = (() => {
    const entradasRecorrentes = [...contratos, ...futuros.filter((f) => f.recorrente && f.tipo === "entrada")];
    const porDia = new Map();
    entradasRecorrentes.forEach((f) => {
      const dia = f.diaVencimento || (f.vencimento ? new Date(`${f.vencimento}T00:00:00`).getDate() : null);
      if (!dia) return;
      const moto = motos?.find((m) => m.id === f.motoId);
      const cliente = moto?.contratoAtual ? clientes?.find((c) => c.id === moto.contratoAtual.clienteId) : null;
      const item = {
        id: f.id,
        label: cliente?.nome || nomeDoFuturo(f),
        sub: moto ? formatPlaca(moto.placa) : null,
        valor: Number(f.valor) || 0,
      };
      if (!porDia.has(dia)) porDia.set(dia, []);
      porDia.get(dia).push(item);
    });
    return [...porDia.entries()].sort((a, b) => a[0] - b[0]);
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
      <div className="rounded-2xl overflow-hidden" style={{ background: "var(--rd-surface)", border: "1px solid var(--rd-border)" }}>
        <div
          onClick={() => setGrupoAberto(aberto ? null : grupo.chave)}
          className="flex items-center justify-between cursor-pointer"
          style={{ padding: "13px 18px" }}
        >
          <div className="flex items-center min-w-0" style={{ gap: 12 }}>
            <div className="flex items-center justify-center flex-shrink-0" style={{ width: 30, height: 30, borderRadius: 9, background: "var(--rd-surface-2)" }}>
              {primeiro.tipo === "entrada" ? <TrendingUp size={15} color="var(--rd-positive)" /> : <TrendingDown size={15} color="var(--rd-negative)" />}
            </div>
            <div className="min-w-0">
              <div className="flex items-center flex-wrap" style={{ gap: 7 }}>
                <span className="truncate" style={{ color: "var(--rd-text)", fontWeight: 600, fontSize: 13.5 }}>{nomeDoFuturo(primeiro)}</span>
                <span
                  style={{ fontSize: 10.5, fontWeight: 700, borderRadius: 999, padding: "1px 8px", background: "var(--rd-surface-2)", color: "var(--rd-text-dim)", flex: "none" }}
                >
                  {ehParcelado ? `${totalParcelas} parcelas` : `${itens.length} motos`}
                </span>
              </div>
              <div style={{ color: "var(--rd-text-dim)", fontSize: 11.5 }}>
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
          <div className="flex items-center flex-shrink-0" style={{ gap: 6 }}>
            <span style={{ color: primeiro.tipo === "entrada" ? "var(--rd-positive)" : "var(--rd-negative)", fontWeight: 700, fontSize: 15 }}>
              {primeiro.tipo === "entrada" ? "+ " : "\u2212 "}
              {formatCurrency(total)}
            </span>
            {aberto ? <ChevronUp size={16} color="var(--rd-text-dim)" /> : <ChevronDown size={16} color="var(--rd-text-dim)" />}
          </div>
        </div>
        <Collapse open={aberto}>
          <div className="flex flex-col px-3 pb-3" style={{ gap: 8 }}>
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
      className={`flex items-center justify-between rounded-2xl${permissoes.podeEditar ? " cursor-pointer" : ""}`}
      style={{
        padding: "13px 18px",
        background: dentroDeGrupo ? "var(--rd-surface-2)" : "var(--rd-surface)",
        border: `1px solid ${dentroDeGrupo ? "transparent" : "var(--rd-border)"}`,
        opacity: jaConfirmadoEsteMes ? 0.55 : 1,
      }}
    >
      <div className="flex items-center min-w-0" style={{ gap: 12 }}>
        <div className="flex items-center justify-center flex-shrink-0" style={{ width: 30, height: 30, borderRadius: 9, background: "var(--rd-surface-2)" }}>
          {f.tipo === "entrada" ? <TrendingUp size={15} color="var(--rd-positive)" /> : <TrendingDown size={15} color="var(--rd-negative)" />}
        </div>
        <div className="min-w-0">
          <div className="flex items-center flex-wrap" style={{ gap: 7 }}>
            <span className="truncate" style={{ color: "var(--rd-text)", fontWeight: 600, fontSize: 13.5 }}>{nomeDoFuturo(f)}</span>
            {f.parcelasTotal > 1 && (
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  borderRadius: 999,
                  padding: "1px 8px",
                  background: "var(--rd-surface-2)",
                  color: "var(--rd-text-dim)",
                  flex: "none",
                }}
              >
                Parcela {f.parcelaAtual || 1}/{f.parcelasTotal}
              </span>
            )}
          </div>
          <div style={{ color: "var(--rd-text-dim)", fontSize: 11.5 }}>
            {f.recorrente ? `Todo mês · dia ${diaDoMes}` : `Vence em ${formatDate(f.vencimento)}`}
            {jaConfirmadoEsteMes && " · mês atual já lançado"}
            {motoLigada && ` · ${formatPlaca(motoLigada.placa)}`}
            {detalheDoFuturo(f) && ` · ${detalheDoFuturo(f)}`}
          </div>
        </div>
      </div>
      <div className="flex items-center flex-shrink-0" style={{ gap: 6 }}>
        <span style={{ color: f.tipo === "entrada" ? "var(--rd-positive)" : "var(--rd-negative)", fontWeight: 700, fontSize: 15 }}>
          {f.tipo === "entrada" ? "+ " : "− "}
          {formatCurrency(f.valor)}
        </span>
        {permissoes.podeEditar && !jaConfirmadoEsteMes && onConfirmar && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onConfirmar(f, f.recorrente ? mesAtualKey : undefined);
            }}
            title={f.tipo === "entrada" ? "Confirmar recebimento" : "Confirmar pagamento"}
            className="mbr-hover-grow flex items-center justify-center"
            style={{ color: "var(--rd-brand-light)", width: 30, height: 30 }}
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
            style={{ color: "var(--rd-text-dim)", width: 30, height: 30, marginRight: -6 }}
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
    );
  };

  return (
    <div className="flex flex-col" style={{ gap: 16 }}>
      <div className="grid grid-cols-1 sm:grid-cols-3" style={{ gap: 12 }}>
        <div className="rounded-2xl" style={{ background: "var(--rd-surface)", border: "1px solid var(--rd-border)", padding: "16px 18px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--rd-text-dim)", marginBottom: 4 }}>
            A receber (12 meses)
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "var(--rd-positive)" }}>{formatCurrency(previstoEntrada12Meses)}</div>
          <div style={{ fontSize: 11.5, color: "var(--rd-text-dim)", marginTop: 2 }}>
            fixo/mês: {formatCurrency(fixoMensalEntrada)} · avulso: {formatCurrency(avulsosPendentesEntrada)}
          </div>
        </div>
        <div className="rounded-2xl" style={{ background: "var(--rd-surface)", border: "1px solid var(--rd-border)", padding: "16px 18px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--rd-text-dim)", marginBottom: 4 }}>
            A pagar (12 meses)
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "var(--rd-negative)" }}>{formatCurrency(previstoSaida12Meses)}</div>
          <div style={{ fontSize: 11.5, color: "var(--rd-text-dim)", marginTop: 2 }}>
            fixo/mês: {formatCurrency(fixoMensalSaida)} · avulso: {formatCurrency(avulsosPendentesSaida)}
          </div>
        </div>
        <div className="rounded-2xl" style={{ background: "var(--rd-surface)", border: "1px solid var(--rd-border)", padding: "16px 18px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--rd-text-dim)", marginBottom: 4 }}>
            Saldo previsto (12 meses)
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: saldoPrevisto12Meses >= 0 ? "var(--rd-positive)" : "var(--rd-negative)" }}>
            {formatCurrency(saldoPrevisto12Meses)}
          </div>
        </div>
      </div>

      {cobrancasPorDia.length > 0 && (
        <div className="rounded-2xl" style={{ background: "var(--rd-surface)", border: "1px solid var(--rd-border)", padding: "20px 22px" }}>
          <span style={{ ...RD_LABEL, display: "block", marginBottom: 12 }}>Agenda de cobranças</span>
          <div className="flex flex-col">
            {(verTodasCobrancas ? cobrancasPorDia : cobrancasPorDia.slice(0, 4)).map(([dia, itens], i) => (
              <div key={dia} className="flex items-start" style={{ gap: 12, padding: "10px 0", borderTop: i === 0 ? "none" : "1px solid var(--rd-row-border)" }}>
                <div
                  className="flex-shrink-0 flex items-center justify-center"
                  style={{ width: 38, height: 38, borderRadius: 10, background: "var(--rd-surface-2)", color: "var(--rd-text)", fontWeight: 700, fontSize: 13 }}
                >
                  {String(dia).padStart(2, "0")}
                </div>
                <div className="flex-1 flex flex-col min-w-0" style={{ gap: 4 }}>
                  {itens.map((it) => (
                    <div key={it.id} className="flex items-center justify-between" style={{ gap: 8, fontSize: 12 }}>
                      <span className="truncate" style={{ color: "var(--rd-text)" }}>
                        {it.label}
                        {it.sub ? ` · ${it.sub}` : ""}
                      </span>
                      <span style={{ color: "var(--rd-positive)", fontWeight: 700, flexShrink: 0 }}>{formatCurrency(it.valor)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {cobrancasPorDia.length > 4 && (
            <button
              onClick={() => setVerTodasCobrancas((v) => !v)}
              style={{ color: "var(--rd-brand-light)", fontSize: 12.5, fontWeight: 700, marginTop: 8, minHeight: 32, background: "none" }}
            >
              {verTodasCobrancas ? "Ver menos" : `Ver mais (${cobrancasPorDia.length - 4})`}
            </button>
          )}
        </div>
      )}

      <div className="rounded-2xl" style={{ background: "var(--rd-surface)", border: "1px solid var(--rd-border)", padding: "20px 22px" }}>
        <span style={{ ...RD_LABEL, display: "block", marginBottom: 12 }}>Previsão por mês</span>
        {futuros.length === 0 ? (
          <div style={{ fontSize: 12.5, color: "var(--rd-text-dim)" }}>Cadastre uma conta futura pra ver a previsão aqui.</div>
        ) : (
          <div style={{ width: "100%", height: 280 }}>
            <ResponsiveContainer>
              <ComposedChart data={projecao} margin={{ left: -12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--rd-border)" vertical={false} />
                <XAxis dataKey="mes" stroke="var(--rd-text-dim)" fontSize={11} axisLine={false} tickLine={false} />
                <YAxis stroke="var(--rd-text-dim)" fontSize={11} tickFormatter={formatCompact} width={56} axisLine={false} tickLine={false} />
                <Tooltip content={<TooltipSemDuplicata formatter={(value, name) => [formatCurrency(value), name]} />} />
                <Legend />
                <Bar dataKey="entrada" name="A receber" fill="var(--rd-positive)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="saida" name="A pagar" fill="var(--rd-negative)" radius={[4, 4, 0, 0]} />
                <Line
                  type="monotone"
                  dataKey="saldo"
                  name="Saldo"
                  stroke="var(--rd-attention)"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: "#C68A3A", strokeWidth: 0 }}
                  activeDot={{ r: 5 }}
                />
                <Line
                  type="monotone"
                  dataKey="saldo"
                  stroke="#E0B87A"
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

      {recorrentes.length > 0 && (
        <div className="flex flex-col" style={{ gap: 10 }}>
          <span style={RD_LABEL}>Todo mês</span>
          <div className="flex flex-col" style={{ gap: 8 }}>
            {(verTodosFixos ? gruposFixos : gruposFixos.slice(0, 4)).map((g) =>
              g.itens.length === 1 ? <FuturoRow key={g.chave} f={g.itens[0]} /> : <GrupoRow key={g.chave} grupo={g} />
            )}
          </div>
          {gruposFixos.length > 4 && (
            <button
              onClick={() => setVerTodosFixos((v) => !v)}
              style={{ color: "var(--rd-brand-light)", fontSize: 12.5, fontWeight: 700, minHeight: 32, background: "none", alignSelf: "flex-start" }}
            >
              {verTodosFixos ? "Ver menos" : `Ver mais (${gruposFixos.length - 4})`}
            </button>
          )}
        </div>
      )}

      <div className="flex flex-col" style={{ gap: 10 }}>
        <span style={RD_LABEL}>Parcelamentos</span>
        {gruposAvulsos.length === 0 ? (
          <div className="rounded-2xl p-6 text-center" style={{ background: "var(--rd-surface)", color: "var(--rd-text-dim)", border: "1px solid var(--rd-border)" }}>
            Nenhum parcelamento ou conta com data marcada.
          </div>
        ) : (
          <>
            <div className="flex flex-col" style={{ gap: 8 }}>
              {(verTodosAvulsos ? gruposAvulsos : gruposAvulsos.slice(0, 4)).map((g) =>
                g.itens.length === 1 ? <FuturoRow key={g.chave} f={g.itens[0]} /> : <GrupoRow key={g.chave} grupo={g} />
              )}
            </div>
            {gruposAvulsos.length > 4 && (
              <button
                onClick={() => setVerTodosAvulsos((v) => !v)}
                style={{ color: "var(--rd-brand-light)", fontSize: 12.5, fontWeight: 700, minHeight: 32, background: "none", alignSelf: "flex-start" }}
              >
                {verTodosAvulsos ? "Ver menos" : `Ver mais (${gruposAvulsos.length - 4})`}
              </button>
            )}
          </>
        )}
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
                    const corItem = pendente ? "var(--rd-attention)" : l.tipo === "entrada" ? "var(--rd-positive)" : "var(--rd-negative)";
                    return (
                      <div
                        key={l.id}
                        style={{
                          background: pendente ? "var(--rd-attention-bg)" : "var(--rd-surface-2)",
                          borderBottom: ultimo ? "none" : "1px solid var(--rd-row-border)",
                        }}
                      >
                        <div onClick={() => setDetalheAberto(detalheEsteAberto ? null : l.id)} className="flex items-center justify-between cursor-pointer" style={{ padding: "13px 18px" }}>
                          <div className="flex items-center min-w-0" style={{ gap: 12 }}>
                            <div
                              className="flex items-center justify-center flex-shrink-0"
                              style={{ width: 30, height: 30, borderRadius: 9, background: pendente ? "#2A2115" : "var(--rd-surface)" }}
                            >
                              {pendente ? (
                                <Clock size={15} color="var(--rd-attention)" />
                              ) : l.tipo === "entrada" ? (
                                <TrendingUp size={15} color="var(--rd-positive)" />
                              ) : (
                                <TrendingDown size={15} color="var(--rd-negative)" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center flex-wrap" style={{ gap: 6 }}>
                                <span className="truncate" style={{ color: "var(--rd-text)", fontWeight: 600, fontSize: 13.5 }}>
                                  {l.categoria || "Sem categoria"}
                                </span>
                                {l.parcelasTotal > 1 && (
                                  <span style={{ fontSize: 10.5, fontWeight: 700, borderRadius: 999, padding: "1px 8px", background: "var(--rd-surface)", color: "var(--rd-text-dim)" }}>
                                    Parcela {l.parcelaAtual || 1}/{l.parcelasTotal}
                                  </span>
                                )}
                                {pendente && (
                                  <span style={{ fontSize: 10.5, fontWeight: 700, borderRadius: 999, padding: "1px 8px", background: "#2A2115", color: "var(--rd-attention)" }}>
                                    Previsto
                                  </span>
                                )}
                              </div>
                              <div style={{ color: "var(--rd-text-dim)", fontSize: 11.5 }}>
                                {formatDate(l.data)}
                                {motoLigada && ` · ${formatPlaca(motoLigada.placa)}`}
                                {pendente && l.recorrente && " · fixo mensal"}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center flex-shrink-0" style={{ gap: 2 }}>
                            <span style={{ color: corItem, fontWeight: 700, fontSize: 15 }}>
                              {l.tipo === "entrada" ? "+ " : "− "}
                              {formatCurrency(l.valor)}
                            </span>
                            {(temDetalhe || pendente || permissoes.podeEditar) &&
                              (detalheEsteAberto ? <ChevronUp size={16} color="var(--rd-text-dim)" /> : <ChevronDown size={16} color="var(--rd-text-dim)" />)}
                            {!pendente && permissoes.podeEditar && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  excluir(l.id);
                                }}
                                className="mbr-hover-grow flex items-center justify-center"
                                style={{ color: "var(--rd-text-dim)", width: 34, height: 34, marginRight: -8 }}
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                        {pendente ? (
                          <Collapse open={detalheEsteAberto}>
                            <div className="flex flex-col" style={{ gap: 10, padding: "10px 18px 14px", borderTop: "1px solid var(--rd-row-border)" }}>
                              <div style={{ fontSize: 12, color: "var(--rd-text-dim)" }}>
                                Ainda não {l.tipo === "entrada" ? "recebido" : "pago"} — essa conta está cadastrada em "Futuros" e ainda não virou um lançamento real.
                              </div>
                              {permissoes.podeEditar && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    confirmarFuturo(l);
                                  }}
                                  className="flex items-center justify-center"
                                  style={{ gap: 7, borderRadius: 12, padding: "9px 0", fontWeight: 700, fontSize: 13, background: "var(--rd-brand-soft)", color: "var(--rd-shell)" }}
                                >
                                  <CheckCircle2 size={14} /> Confirmar {l.tipo === "entrada" ? "recebimento" : "pagamento"}
                                </button>
                              )}
                            </div>
                          </Collapse>
                        ) : (
                          <Collapse open={detalheEsteAberto}>
                            <div className="flex flex-col" style={{ gap: 7, padding: "10px 18px 14px", borderTop: "1px solid var(--rd-row-border)" }}>
                              {l.natureza && (
                                <div className="flex items-center justify-between" style={{ fontSize: 12 }}>
                                  <span style={{ color: "var(--rd-text-faint)" }}>Natureza</span>
                                  <span style={{ color: "var(--rd-text-muted)" }}>{l.natureza}</span>
                                </div>
                              )}
                              {l.forma && (
                                <div className="flex items-center justify-between" style={{ fontSize: 12 }}>
                                  <span style={{ color: "var(--rd-text-faint)" }}>Forma de pagamento</span>
                                  <span style={{ color: "var(--rd-text-muted)" }}>{l.forma}</span>
                                </div>
                              )}
                              {l.descricao && (
                                <div className="flex items-center justify-between" style={{ gap: 12, fontSize: 12 }}>
                                  <span style={{ color: "var(--rd-text-faint)", flexShrink: 0 }}>Detalhe</span>
                                  <span style={{ color: "var(--rd-text-muted)", textAlign: "right" }}>{l.descricao}</span>
                                </div>
                              )}
                              {permissoes.podeEditar && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setModal(l);
                                  }}
                                  className="flex items-center"
                                  style={{ gap: 5, color: "var(--rd-brand-light)", fontSize: 12, fontWeight: 700, minHeight: 32, marginTop: 2, background: "none" }}
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
    const cor = pendente ? "var(--rd-attention)" : primeiro.tipo === "entrada" ? "var(--rd-positive)" : "var(--rd-negative)";
    return (
      <div style={{ borderBottom: ultimo ? "none" : "1px solid var(--rd-row-border)", background: pendente ? "var(--rd-attention-bg)" : "var(--rd-surface-2)" }}>
        <div
          onClick={() => setGrupoLancAberto(aberto ? null : grupo.chave)}
          className="flex items-center justify-between cursor-pointer"
          style={{ padding: "13px 18px" }}
        >
          <div className="flex items-center min-w-0" style={{ gap: 12 }}>
            <div className="flex items-center justify-center flex-shrink-0" style={{ width: 30, height: 30, borderRadius: 9, background: "var(--rd-surface)" }}>
              {primeiro.tipo === "entrada" ? <TrendingUp size={15} color="var(--rd-positive)" /> : <TrendingDown size={15} color="var(--rd-negative)" />}
            </div>
            <div className="min-w-0">
              <div className="flex items-center flex-wrap" style={{ gap: 6 }}>
                <span className="truncate" style={{ color: "var(--rd-text)", fontWeight: 600, fontSize: 13.5 }}>{primeiro.categoria || "Sem categoria"}</span>
                <span style={{ fontSize: 10.5, fontWeight: 700, borderRadius: 999, padding: "1px 8px", background: "var(--rd-surface)", color: "var(--rd-text-dim)", flex: "none" }}>
                  {itens.length}x
                </span>
              </div>
              <div style={{ color: "var(--rd-text-dim)", fontSize: 11.5 }}>
                {itens.length} lançamentos iguais neste mês
              </div>
            </div>
          </div>
          <div className="flex items-center flex-shrink-0" style={{ gap: 4 }}>
            <span style={{ color: cor, fontWeight: 700, fontSize: 15 }}>
              {primeiro.tipo === "entrada" ? "+ " : "\u2212 "}
              {formatCurrency(total)}
            </span>
            {aberto ? <ChevronUp size={16} color="var(--rd-text-dim)" /> : <ChevronDown size={16} color="var(--rd-text-dim)" />}
          </div>
        </div>
        <Collapse open={aberto}>
          <div style={{ borderTop: "1px solid var(--rd-row-border)" }}>
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
    <div className="flex flex-col" style={{ gap: 18, fontFamily: "var(--rd-font)" }}>
      <div className="flex items-center flex-wrap" style={{ gap: 16 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--rd-text)" }}>Caixa</h1>
        <div className="flex items-center" style={{ gap: 10, marginLeft: "auto" }}>
          <div
            ref={viewToggleRef}
            className="relative flex"
            style={{ background: "var(--rd-surface-2)", border: "1px solid var(--rd-border)", borderRadius: 999, padding: 3 }}
          >
            {viewPillRect && (
              <span
                className="absolute"
                style={{
                  left: 0,
                  top: viewPillRect.top,
                  width: viewPillRect.width,
                  height: viewPillRect.height,
                  background: "var(--rd-brand)",
                  borderRadius: 999,
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
                className="relative"
                style={{
                  padding: "6px 14px",
                  fontSize: 12.5,
                  fontWeight: view === v.id ? 700 : 600,
                  color: view === v.id ? "#F0F5EE" : "var(--rd-text-dim)",
                  transition: "color 0.15s ease",
                  zIndex: 1,
                  background: "none",
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
              className="flex items-center overflow-hidden"
              style={{
                gap: 6,
                background: "var(--rd-brand-soft)",
                color: "var(--rd-shell)",
                borderRadius: 999,
                padding: "10px 16px",
                fontSize: 13.5,
                fontWeight: 700,
                whiteSpace: "nowrap",
                width: view === "lancado" ? 100 : 150,
                transition: "width 0.32s cubic-bezier(0.22, 1, 0.36, 1)",
              }}
            >
              <Plus size={15} strokeWidth={3} style={{ flexShrink: 0 }} />
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
        />
      ) : (
        <>
      {mesesOrdenados.length === 0 && (
        <div className="rounded-2xl p-6 text-center" style={{ background: "var(--rd-surface)", color: "var(--rd-text-dim)", border: "1px solid var(--rd-border)" }}>
          Nenhum lançamento ainda.
        </div>
      )}

      {ordenados.length > 0 && (
        <div className="rounded-2xl" style={{ background: "var(--rd-surface)", border: "1px solid var(--rd-border)", padding: "20px 22px" }}>
          <span style={{ ...RD_LABEL, display: "block", marginBottom: 12 }}>Resumo mensal</span>
          <div className="flex flex-col" style={{ gap: 8 }}>
            {(verTodosResumo ? mesesComLancamentos : mesesComLancamentos.slice(0, 1)).map((mesKey) => {
              const itensResumo = porMes[mesKey];
              const entradaResumo = itensResumo.filter((l) => l.tipo === "entrada").reduce((s, l) => s + Number(l.valor), 0);
              const saidaResumo = itensResumo.filter((l) => l.tipo === "saida").reduce((s, l) => s + Number(l.valor), 0);
              const saldoResumo = entradaResumo - saidaResumo;
              return (
                <div key={mesKey} className="rounded-xl" style={{ background: "var(--rd-surface-2)", border: "1px solid var(--rd-border)", padding: "10px 14px" }}>
                  <div className="flex items-center justify-between flex-wrap" style={{ gap: 8, marginBottom: 6 }}>
                    <span style={{ color: "var(--rd-text)", fontWeight: 700, fontSize: 14 }}>
                      {mesKey === "sem-data" ? "Sem data" : monthLabel(mesKey)}
                    </span>
                    <span style={{ color: saldoResumo >= 0 ? "var(--rd-positive)" : "var(--rd-negative)", fontWeight: 700, fontSize: 14 }}>
                      Saldo: {formatCurrency(saldoResumo)}
                    </span>
                  </div>
                  <div className="flex items-center flex-wrap" style={{ gap: 16, fontSize: 12, color: "var(--rd-text-dim)" }}>
                    <span>
                      Entradas <b style={{ color: "var(--rd-positive)" }}>{formatCurrency(entradaResumo)}</b>
                    </span>
                    <span>
                      Saídas <b style={{ color: "var(--rd-negative)" }}>{formatCurrency(saidaResumo)}</b>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          {mesesComLancamentos.length > 1 && (
            <button
              onClick={() => setVerTodosResumo((v) => !v)}
              style={{ color: "var(--rd-brand-light)", fontSize: 12.5, fontWeight: 700, marginTop: 10, minHeight: 32, background: "none" }}
            >
              {verTodosResumo ? "Ver menos" : `Ver mais (${mesesComLancamentos.length - 1})`}
            </button>
          )}
        </div>
      )}

      <div className="flex flex-col" style={{ gap: 10 }}>
        {mesesOrdenados.map((mesKey) => {
          const itensReais = porMes[mesKey] || [];
          const pendentesDoMes = pendenciasPorMes[mesKey] || [];
          const itens = [...itensReais, ...pendentesDoMes].sort((a, b) => (a.data < b.data ? 1 : -1));
          const totalEntrada = itensReais.filter((l) => l.tipo === "entrada").reduce((s, l) => s + Number(l.valor), 0);
          const totalSaida = itensReais.filter((l) => l.tipo === "saida").reduce((s, l) => s + Number(l.valor), 0);
          const saldo = totalEntrada - totalSaida;
          const aberto = expandido === mesKey;
          return (
            <div key={mesKey} className="rounded-2xl overflow-hidden" style={{ background: "var(--rd-surface)", border: "1px solid var(--rd-border)" }}>
              <button className="w-full flex items-center justify-between text-left" onClick={() => setExpandido(aberto ? null : mesKey)} style={{ padding: "16px 18px" }}>
                <div>
                  <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--rd-text)" }}>{mesKey === "sem-data" ? "Sem data" : monthLabel(mesKey)}</div>
                  <div style={{ fontSize: 11.5, color: "var(--rd-text-dim)" }}>
                    {itensReais.length} lançamento{itensReais.length === 1 ? "" : "s"}
                    {pendentesDoMes.length > 0 && (
                      <span style={{ color: "var(--rd-attention)" }}>
                        {" "}
                        · {pendentesDoMes.length} previsto{pendentesDoMes.length === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center" style={{ gap: 10 }}>
                  <span style={{ color: saldo >= 0 ? "var(--rd-positive)" : "var(--rd-negative)", fontWeight: 700, fontSize: 15 }}>{formatCurrency(saldo)}</span>
                  {aberto ? <ChevronUp size={18} color="var(--rd-text-dim)" /> : <ChevronDown size={18} color="var(--rd-text-dim)" />}
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

/* ===========================================================
   REDESIGN — átomos da Visão geral nova (Etapa 3)
=========================================================== */
const RD_LABEL = { fontSize: 11.5, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--rd-brand-soft)" };

// "itens", quando vem, faz o valor abrir o detalhamento (o que compõe aquele número)
// ao toque/hover — é o que devolve o "clico e vejo quais foram os gastos"
function LegendaPonto({ cor, label, valor, itens, fmt }) {
  const numero = <span style={{ fontSize: 14, fontWeight: 700, color: "var(--rd-text)" }}>{valor}</span>;
  return (
    <div className="flex items-center" style={{ gap: 9 }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: cor, flex: "none" }} />
      <span style={{ fontSize: 12.5, color: "var(--rd-text-dim)", width: 64 }}>{label}</span>
      {itens && itens.length > 0 ? (
        <ValorComDetalhe itens={itens} fmt={fmt}>
          {numero}
        </ValorComDetalhe>
      ) : (
        numero
      )}
    </div>
  );
}

function ValorPequeno({ label, valor, cor = "var(--rd-text)" }) {
  return (
    <div className="flex flex-col" style={{ gap: 2 }}>
      <span style={{ fontSize: 12, color: "var(--rd-text-dim)" }}>{label}</span>
      <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em", color: cor }}>{valor}</span>
    </div>
  );
}

// gráfico de entradas/saídas/lucro em segmentos retos (sem depender de biblioteca de
// gráfico) — a mesma ideia visual do mockup (área embaixo das entradas, linha tracejada
// pro lucro), só que sempre correto pro número de meses que o período selecionado tiver
// Gráfico do caixa mês a mês. Três linhas (o que entrou, o que saiu e a sobra) sobre a
// mesma escala, pra dar de bater o olho e ver se o mês fechou pra cima ou pra baixo.
// Ele é TOCÁVEL: passar o mouse (ou arrastar o dedo) escolhe um mês, e os números desse
// mês aparecem escritos acima do desenho — antes o gráfico não dizia nada ao ser clicado
// e não tinha nem o nome dos meses embaixo, então não dava pra saber o que estava vendo.
function GraficoCaixa({ data, fmt }) {
  const w = 640;
  const h = 150;
  const [iAtivo, setIAtivo] = useState(null);
  if (!data.length) return <div style={{ height: h }} />;

  const vals = data.flatMap((d) => [d.Entradas, d.Saídas, d.Lucro]);
  const maxVal = Math.max(1, ...vals);
  const minVal = Math.min(0, ...vals);
  const range = Math.max(1, maxVal - minVal);
  const y = (v) => h - 10 - ((v - minVal) / range) * (h - 20);
  const x = (i) => (data.length > 1 ? (i * w) / (data.length - 1) : w / 2);
  const pathFor = (key) => data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(d[key]).toFixed(1)}`).join(" ");
  const areaEntradas = `${pathFor("Entradas")} L${x(data.length - 1).toFixed(1)} ${h} L${x(0).toFixed(1)} ${h} Z`;

  // sem nada escolhido, mostra o mês mais recente — o gráfico nunca fica "mudo"
  const iMostrado = iAtivo ?? data.length - 1;
  const doMes = data[iMostrado];

  const escolherPorPosicao = (clientX, alvo) => {
    const r = alvo.getBoundingClientRect();
    if (!r.width) return;
    const frac = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    setIAtivo(Math.round(frac * (data.length - 1)));
  };

  const linhas = [
    { key: "Entradas", rotulo: "Entrou", cor: "var(--rd-positive)" },
    { key: "Saídas", rotulo: "Saiu", cor: "var(--rd-negative)" },
    { key: "Lucro", rotulo: "Sobrou", cor: "var(--rd-attention)" },
  ];

  return (
    <div className="flex flex-col" style={{ gap: 10 }}>
      {/* leitura do mês escolhido — é isso que faz o gráfico "responder" ao toque */}
      <div className="flex items-center flex-wrap" style={{ gap: 14, minHeight: 20 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--rd-text)" }}>{doMes.mes}</span>
        {linhas.map((l) => (
          <span key={l.key} className="flex items-center" style={{ gap: 6, fontSize: 12 }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: l.cor, flex: "none" }} />
            <span style={{ color: "var(--rd-text-dim)" }}>{l.rotulo}</span>
            <span style={{ fontWeight: 700, color: "var(--rd-text)" }}>{fmt ? fmt(doMes[l.key]) : doMes[l.key]}</span>
          </span>
        ))}
      </div>

      <div
        style={{ position: "relative", cursor: "crosshair", touchAction: "pan-y" }}
        onMouseMove={(e) => escolherPorPosicao(e.clientX, e.currentTarget)}
        onMouseLeave={() => setIAtivo(null)}
        onTouchStart={(e) => escolherPorPosicao(e.touches[0].clientX, e.currentTarget)}
        onTouchMove={(e) => escolherPorPosicao(e.touches[0].clientX, e.currentTarget)}
      >
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: "100%", height: h, display: "block" }}>
          <line x1="0" y1={y(0)} x2={w} y2={y(0)} stroke="var(--rd-border)" strokeWidth="1" />
          <path d={areaEntradas} fill="var(--rd-positive)" opacity="0.07" />
          <path d={pathFor("Entradas")} fill="none" stroke="var(--rd-positive)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d={pathFor("Saídas")} fill="none" stroke="var(--rd-negative)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
          <path d={pathFor("Lucro")} fill="none" stroke="var(--rd-attention)" strokeWidth="2" strokeDasharray="4 4" strokeLinecap="round" strokeLinejoin="round" />
          {/* guia vertical + bolinhas no mês escolhido. vectorEffect impede que o
              preserveAspectRatio="none" estique a espessura do traço e da bolinha */}
          <line x1={x(iMostrado)} y1="0" x2={x(iMostrado)} y2={h} stroke="var(--rd-text-faint)" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          {linhas.map((l) => (
            <circle
              key={l.key}
              cx={x(iMostrado)}
              cy={y(doMes[l.key])}
              r="3.5"
              fill="var(--rd-surface)"
              stroke={l.cor}
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      </div>

      {/* nome dos meses embaixo — em HTML, não dentro do SVG, senão o
          preserveAspectRatio="none" distorceria as letras horizontalmente */}
      <div className="flex" style={{ justifyContent: "space-between", fontSize: 10.5, color: "var(--rd-text-faint)" }}>
        {data.map((d, i) => (
          <span
            key={d.mes}
            style={{
              flex: "1 1 0",
              textAlign: i === 0 ? "left" : i === data.length - 1 ? "right" : "center",
              fontWeight: i === iMostrado ? 700 : 500,
              color: i === iMostrado ? "var(--rd-text-muted)" : "var(--rd-text-faint)",
            }}
          >
            {d.mes}
          </span>
        ))}
      </div>
    </div>
  );
}

function DashboardView({ motos, lancamentos, clientes, futuros, config, onIrPara }) {
  const alugadas = motos.filter((m) => m.status === "alugada").length;
  const disponiveis = motos.filter((m) => m.status === "disponivel").length;
  const motosVencidas = motos.filter((m) => m.status === "alugada" && isContratoVencido(m.contratoAtual, pagamentosDaMoto(m, lancamentos)));
  const vencidas = motosVencidas.length;
  const nomesClientesVencidos = motosVencidas
    .map((m) => clientes.find((c) => c.id === m.contratoAtual?.clienteId)?.nome)
    .filter(Boolean);

  // clientes sem nenhuma moto com contrato ativo — a "fila de espera". Não existe campo
  // de data de cadastro no modelo de cliente, então a ordem é a mesma em que já vêm na
  // lista (não dá pra ordenar por "mais antigo" sem inventar um campo que não existe)
  const clientesSemContrato = clientes.filter((c) => !motos.some((m) => m.contratoAtual?.clienteId === c.id));

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
  // usa o mês atual se ele já tiver algum lançamento; senão, cai pro mês mais recente com
  // dados (evita mostrar o mês zerado só porque ainda não lançou nada no mês corrente) —
  // mas dá pra andar pra trás/frente no seletor do cartão de Caixa
  const mesAutoDetectado = mesesComDados.has(mesCalendario) ? mesCalendario : [...mesesComDados].sort().pop() || mesCalendario;
  const [mesEscolhido, setMesEscolhido] = useState(null);
  const mesRef = mesEscolhido || mesAutoDetectado;
  // o botão "Atual" encolhe de volta ao ser clicado em vez de sumir na hora — por isso
  // continua montado mais um instante, até a animação de saída terminar
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
  const irParaMesAnterior = () => {
    setDirecaoMes(-1);
    const [ano, mesN] = mesRef.split("-").map(Number);
    const d = new Date(ano, mesN - 2, 1);
    setMesEscolhido(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };
  const irParaProximoMes = () => {
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
  const investimentosMes = lancamentos.filter((l) => l.tipo === "saida" && l.natureza === "Expansão" && noMes(l.data)).reduce((s, l) => s + Number(l.valor), 0);

  // detalhamento que abre ao tocar/passar o mouse nos valores do cartão de Caixa —
  // agrupa por categoria (entradas) e por natureza (saídas) em vez de listar lançamento
  // por lançamento, senão um mês movimentado viraria uma lista sem fim
  const agruparPorChave = (lista, chaveFn, valorFn) => {
    const porChave = new Map();
    lista.forEach((item) => {
      const chave = chaveFn(item) || "Sem categoria";
      porChave.set(chave, (porChave.get(chave) || 0) + Number(valorFn(item)));
    });
    return [...porChave.entries()].sort((a, b) => b[1] - a[1]);
  };
  const detalhesEntradas = agruparPorChave(
    lancamentos.filter((l) => l.tipo === "entrada" && noMes(l.data)),
    (l) => l.categoria,
    (l) => l.valor
  ).map(([label, total]) => ({ label, total, cor: "var(--rd-positive)" }));
  const detalhesSaidas = (() => {
    const itens = agruparPorChave(
      lancamentos.filter((l) => l.tipo === "saida" && l.natureza !== "Expansão" && noMes(l.data)),
      (l) => l.natureza,
      (l) => l.valor
    ).map(([label, total]) => ({ label, total, cor: "var(--rd-negative)" }));
    if (manutencaoMes > 0) itens.push({ label: "Manutenção", total: manutencaoMes, cor: "var(--rd-negative)" });
    if (investimentosMes > 0) itens.push({ label: "Expansão/investimento", total: investimentosMes, cor: "var(--rd-attention)" });
    return itens;
  })();
  // composição do resultado: o que entrou, cada grupo do que saiu, e a sobra no fim
  const detalhesResultado = [
    { label: "Entrou", total: entradasMes, cor: "var(--rd-positive)" },
    ...detalhesSaidas.filter((d) => d.label !== "Expansão/investimento").map((d) => ({ ...d, total: -d.total })),
    { label: lucroMes >= 0 ? "Sobrou" : "Faltou", total: lucroMes, cor: lucroMes >= 0 ? "var(--rd-positive)" : "var(--rd-negative)" },
  ];

  const [refAno, refMesNum] = mesRef.split("-").map(Number);

  // nunca mostra meses anteriores ao primeiro lançamento — a empresa não existia ainda
  const mesesOrdenadosComDados = [...mesesComDados].sort();
  const primeiroMesComDados = mesesOrdenadosComDados[0] || mesRef;
  const [anoIni, mesIni] = primeiroMesComDados.split("-").map(Number);
  const inicioAbs = anoIni * 12 + (mesIni - 1);
  const fimAbs = refAno * 12 + (refMesNum - 1);
  const mesesDisponiveis = fimAbs - inicioAbs + 1;

  const [periodoGrafico, setPeriodoGrafico] = useState("3m"); // "3m" | "6m" | "12m"
  const periodoToggleRef = useRef(null);
  const periodoSlotRefs = useRef({});
  const [periodoPillRect, setPeriodoPillRect] = useState(null);

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

  const [valoresOcultos, setValoresOcultos] = useState(false);
  const fmt = valoresOcultos ? () => "R$ ••••••" : formatCurrency;

  const qtdMesesAlvo = { "3m": 3, "6m": 6, "12m": 12 }[periodoGrafico] || 3;
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
    return { mes: monthLabel(key), Entradas: entradasDoMes, Saídas: saidasDoMes, Lucro: entradasDoMes - saidasDoMes };
  });

  // margem média dos últimos 12 meses — fixa, independente do período escolhido no
  // seletor do gráfico. Soma entradas/lucro do período (em vez de fazer a média das
  // porcentagens mês a mês), senão um mês fraco pesaria igual a um mês forte
  const meses12 = Math.max(1, Math.min(12, mesesDisponiveis));
  let entradas12m = 0;
  let lucro12m = 0;
  for (let i = 0; i < meses12; i++) {
    const abs = fimAbs - i;
    const ano = Math.floor(abs / 12);
    const mesN = (abs % 12) + 1;
    const key = `${ano}-${String(mesN).padStart(2, "0")}`;
    const doMesX = lancamentos.filter((l) => l.data?.slice(0, 7) === key);
    const manut = todasManutencoes.filter((m) => m.data?.slice(0, 7) === key).reduce((s, m) => s + Number(m.valorGasto), 0);
    const e = doMesX.filter((l) => l.tipo === "entrada").reduce((s, l) => s + Number(l.valor), 0);
    const s = doMesX.filter((l) => l.tipo === "saida" && l.natureza !== "Expansão").reduce((s2, l) => s2 + Number(l.valor), 0) + manut;
    entradas12m += e;
    lucro12m += e - s;
  }
  const margemMedia12m = entradas12m > 0 ? (lucro12m / entradas12m) * 100 : 0;

  const contratosAtivos = motos.filter((m) => m.contratoAtual);
  const faturamentoPrevisto = contratosAtivos.reduce((s, m) => s + Number(m.contratoAtual.valorMensal || 0), 0);
  const ticketMedio = contratosAtivos.length ? faturamentoPrevisto / contratosAtivos.length : 0;
  const investimentoFrota = motos.reduce((s, m) => s + Number(m.valorCompra || 0), 0);

  // dia de vencimento mais próximo entre os contratos em dia — usado no cartão de
  // Cobrança quando não há nada em atraso ("próx. venc. em X dias")
  const proximoVencimentoDias = (() => {
    const hoje = new Date();
    const hojeZero = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
    const dias = contratosAtivos
      .filter((m) => !motosVencidas.includes(m))
      .map((m) => diaVencimentoDoContrato(m.contratoAtual))
      .filter(Boolean)
      .map((dia) => {
        let venc = new Date(hoje.getFullYear(), hoje.getMonth(), dia);
        if (venc < hojeZero) venc = new Date(hoje.getFullYear(), hoje.getMonth() + 1, dia);
        return Math.round((venc - hojeZero) / (1000 * 60 * 60 * 24));
      });
    return dias.length ? Math.min(...dias) : null;
  })();

  // retorno do investimento por moto — quanto já foi recebido de verdade (lançamentos de
  // entrada que citam a placa) vs quanto ela custou (compra + custos extras + manutenção)
  const retornoPorMoto = motos
    .map((m) => {
      const custosExtrasTotal = custosDaMoto(m, lancamentos).reduce((s, c) => s + Number(c.valorGasto || 0), 0);
      const manutencaoTotal = (m.manutencoes || []).reduce((s, x) => s + Number(x.valorGasto || 0), 0);
      const investimentoTotal = Number(m.valorCompra || 0) + custosExtrasTotal + manutencaoTotal;
      const recebidoReal = pagamentosDaMoto(m, lancamentos).reduce((s, p) => s + Number(p.valor), 0);
      const restante = Math.max(0, investimentoTotal - recebidoReal);
      const percentPago = investimentoTotal > 0 ? Math.min(100, (recebidoReal / investimentoTotal) * 100) : 0;
      return { placa: m.placa, status: m.status, investimentoTotal, recebidoReal, restante, percentPago, jaPagou: restante <= 0 && investimentoTotal > 0 };
    })
    .filter((r) => r.investimentoTotal > 0);

  // mais perto de se pagar primeiro
  const paybackPorMoto = [...retornoPorMoto].sort((a, b) => b.percentPago - a.percentPago);

  // mês anterior ao mês de referência — usado só pra calcular a variação (%) do faturamento
  const mesAnteriorKey = (() => {
    const d = new Date(refAno, refMesNum - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  })();
  const entradasMesAnterior = lancamentos
    .filter((l) => l.tipo === "entrada" && l.data?.slice(0, 7) === mesAnteriorKey)
    .reduce((s, l) => s + Number(l.valor), 0);
  const deltaFaturamento = entradasMesAnterior > 0 ? ((entradasMes - entradasMesAnterior) / entradasMesAnterior) * 100 : null;
  const rotuloMesAnterior = monthLabel(mesAnteriorKey);

  const faturamentoAcumulado = lancamentos.filter((l) => l.tipo === "entrada").reduce((s, l) => s + Number(l.valor), 0);

  const { itensEntrada: itensEntrada7d, itensSaida: itensSaida7d } = futurosProximosDias(futuros, motos, 7);
  const { saldoPrevisto12Meses } = totaisFuturos(futuros, motos);
  const itens7d = [...itensEntrada7d.map((i) => ({ ...i, sinal: 1 })), ...itensSaida7d.map((i) => ({ ...i, sinal: -1 }))]
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);
  // "a receber esse mês" = o que os contratos ativos ainda vão gerar no mês vs o que já entrou
  const aReceberMes = Math.max(0, faturamentoPrevisto - entradasMes);

  // faixa "PRECISA DE VOCÊ" — ordenado por severidade; Cobrança nunca some (serve de
  // confirmação quando está tudo em dia)
  const cardsPendencia = [];
  if (motosParadas.length > 0) {
    cardsPendencia.push({
      key: "paradas",
      atencao: true,
      Icon: Clock,
      titulo: `${motosParadas.length} moto${motosParadas.length === 1 ? "" : "s"} parada${motosParadas.length === 1 ? "" : "s"}`,
      sub: motosParadas.slice(0, 3).map((m) => `${formatPlaca(m.placa)} há ${m.dias} dia${m.dias === 1 ? "" : "s"}`).join(" · "),
      acao: "Alugar",
      onClick: () => onIrPara?.("motos"),
    });
  }
  if (clientesSemContrato.length > 0) {
    cardsPendencia.push({
      key: "fila",
      atencao: false,
      Icon: Users,
      titulo: `${clientesSemContrato.length} cliente${clientesSemContrato.length === 1 ? "" : "s"} na espera`,
      sub: clientesSemContrato.slice(0, 3).map((c) => c.nome).join(", "),
      acao: "Ver fila",
      onClick: () => onIrPara?.("clientes"),
    });
  }
  cardsPendencia.push({
    key: "cobranca",
    atencao: vencidas > 0,
    Icon: vencidas > 0 ? AlertTriangle : CheckCircle2,
    titulo: vencidas > 0 ? `${vencidas} em atraso` : "Nada em atraso",
    sub:
      vencidas > 0
        ? nomesClientesVencidos.slice(0, 3).join(", ")
        : contratosAtivos.length > 0
        ? `${contratosAtivos.length - vencidas} cliente${contratosAtivos.length - vencidas === 1 ? "" : "s"} em dia${
            proximoVencimentoDias != null ? ` · próx. venc. em ${proximoVencimentoDias} dia${proximoVencimentoDias === 1 ? "" : "s"}` : ""
          }`
        : "Nenhum contrato ativo ainda.",
    acao: vencidas > 0 ? "Cobrar" : null,
    onClick: vencidas > 0 ? () => onIrPara?.("fluxo") : undefined,
  });
  const contagemPendencias = cardsPendencia.filter((c) => c.atencao).length;

  return (
    <div className="flex flex-col" style={{ gap: 22 }}>
      {/* Faixa 1 — Precisa de você */}
      <div className="flex flex-col" style={{ gap: 11 }}>
        <div className="flex items-baseline" style={{ gap: 10 }}>
          <span style={{ ...RD_LABEL, color: "var(--rd-attention)" }}>Precisa de você</span>
          <span style={{ fontSize: 12.5, color: "var(--rd-text-dim)" }}>
            {contagemPendencias} pendência{contagemPendencias === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex flex-col lg:flex-row" style={{ gap: 12 }}>
          {cardsPendencia.map((c) => {
            const Icon = c.Icon;
            return (
              <div
                key={c.key}
                style={{
                  flex: 1,
                  minWidth: 0,
                  background: c.atencao ? "var(--rd-attention-bg)" : "var(--rd-surface)",
                  border: `1px solid ${c.atencao ? "var(--rd-attention-border)" : "var(--rd-border)"}`,
                  borderRadius: 14,
                  padding: "16px 18px",
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                }}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    background: c.atencao ? "#2A2115" : "#1E2A22",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flex: "none",
                    color: c.atencao ? "var(--rd-attention)" : "var(--rd-positive)",
                  }}
                >
                  <Icon size={18} strokeWidth={2.75} />
                </div>
                <div className="flex flex-col" style={{ gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 14.5, fontWeight: 700, color: "var(--rd-text)" }}>{c.titulo}</span>
                  <span className="truncate" style={{ fontSize: 12.5, color: c.atencao ? "var(--rd-attention-text)" : "var(--rd-text-dim)" }}>
                    {c.sub}
                  </span>
                </div>
                {c.acao && (
                  <button
                    onClick={c.onClick}
                    style={{
                      marginLeft: "auto",
                      fontSize: 12.5,
                      fontWeight: 700,
                      color: c.atencao ? "var(--rd-attention)" : "var(--rd-brand-light)",
                      border: `1px solid ${c.atencao ? "var(--rd-attention-border)" : "#2E4034"}`,
                      borderRadius: 999,
                      padding: "7px 14px",
                      flex: "none",
                      background: "transparent",
                    }}
                  >
                    {c.acao}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Faixa 2 — Caixa do mês + Frota agora */}
      <div className="flex flex-col lg:flex-row" style={{ gap: 18 }}>
        <div
          className="flex flex-col"
          style={{ flex: "1.35 1 380px", minWidth: 0, background: "var(--rd-surface)", border: "1px solid var(--rd-border)", borderRadius: 16, padding: "22px 24px", gap: 20 }}
        >
          <div className="flex items-center flex-wrap" style={{ gap: 10 }}>
            <span style={RD_LABEL}>Caixa de</span>
            {/* seletor de mês — dá pra voltar pra agosto, julho etc. e a tela inteira
                (valores, detalhamento e gráfico) acompanha o mês escolhido */}
            <div
              className="flex items-center"
              style={{ gap: 2, background: "var(--rd-surface-2)", border: "1px solid var(--rd-border)", borderRadius: 999, padding: "3px 5px" }}
            >
              <button
                onClick={irParaMesAnterior}
                aria-label="Mês anterior"
                className="flex items-center justify-center"
                style={{ width: 24, height: 24, borderRadius: 999, color: "var(--rd-text-muted)", background: "none" }}
              >
                <ChevronLeft size={15} strokeWidth={2.75} />
              </button>
              <span className="relative inline-block overflow-hidden text-center" style={{ minWidth: 62, height: 16 }}>
                {/* um span só, remontado a cada mês (via key) — nunca dois rótulos
                    sobrepostos misturando as letras de dois meses */}
                <span
                  key={rotuloMes}
                  className="absolute inset-0"
                  style={{
                    fontSize: 12.5,
                    fontWeight: 700,
                    color: "var(--rd-text)",
                    animation: `${direcaoMes >= 0 ? "mbrMesEntraDireita" : "mbrMesEntraEsquerda"} 0.26s cubic-bezier(0.32, 0.72, 0, 1) both`,
                  }}
                >
                  {rotuloMes}
                </span>
              </span>
              <button
                onClick={irParaProximoMes}
                disabled={!podeAvancarMes}
                aria-label="Próximo mês"
                className="flex items-center justify-center"
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 999,
                  background: "none",
                  color: "var(--rd-text-muted)",
                  opacity: podeAvancarMes ? 1 : 0.35,
                  cursor: podeAvancarMes ? "pointer" : "default",
                }}
              >
                <ChevronRight size={15} strokeWidth={2.75} />
              </button>
            </div>
            {botaoAtualMontado && (
              <button
                onClick={() => setMesEscolhido(null)}
                className={mesEscolhido ? "mbr-botao-atual-entra" : "mbr-botao-atual-sai"}
                style={{
                  fontSize: 11.5,
                  fontWeight: 700,
                  borderRadius: 999,
                  padding: "4px 11px",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  background: "var(--rd-brand)",
                  color: "var(--rd-brand-light)",
                }}
              >
                Atual
              </button>
            )}
            <button
              onClick={() => setValoresOcultos((v) => !v)}
              title={valoresOcultos ? "Mostrar valores" : "Ocultar valores"}
              style={{
                marginLeft: "auto",
                width: 30,
                height: 30,
                borderRadius: 999,
                background: "var(--rd-surface-2)",
                border: "1px solid var(--rd-border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--rd-text-muted)",
              }}
            >
              {valoresOcultos ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
            <div ref={periodoToggleRef} style={{ position: "relative", display: "flex", gap: 2, background: "var(--rd-surface-2)", border: "1px solid var(--rd-border)", borderRadius: 999, padding: 3 }}>
              {periodoPillRect && (
                <span
                  style={{
                    position: "absolute",
                    left: periodoPillRect.left,
                    top: periodoPillRect.top,
                    width: periodoPillRect.width,
                    height: periodoPillRect.height,
                    background: "var(--rd-brand)",
                    borderRadius: 999,
                    transition: "left 0.25s cubic-bezier(0.32, 0.72, 0, 1)",
                  }}
                />
              )}
              {["3m", "6m", "12m"].map((p) => (
                <button
                  key={p}
                  ref={(el) => (periodoSlotRefs.current[p] = el)}
                  onClick={() => setPeriodoGrafico(p)}
                  style={{
                    position: "relative",
                    padding: "4px 11px",
                    fontSize: 12,
                    fontWeight: periodoGrafico === p ? 700 : 600,
                    color: periodoGrafico === p ? "#F0F5EE" : "var(--rd-text-dim)",
                    background: "none",
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-end flex-wrap" style={{ gap: 28 }}>
            <div className="flex flex-col" style={{ gap: 6 }}>
              <span style={{ fontSize: 12.5, color: "var(--rd-text-dim)" }}>Resultado do mês</span>
              <ValorComDetalhe itens={detalhesResultado} fmt={fmt}>
                <span style={{ fontSize: 42, fontWeight: 700, letterSpacing: "-0.035em", lineHeight: 1, color: lucroMes >= 0 ? "var(--rd-positive)" : "var(--rd-negative)" }}>
                  {lucroMes < 0 ? "− " : ""}
                  {fmt(Math.abs(lucroMes))}
                </span>
              </ValorComDetalhe>
            </div>
            <div className="flex flex-wrap" style={{ gap: 26, paddingBottom: 6, borderLeft: "1px solid var(--rd-border)", paddingLeft: 26 }}>
              <div className="flex flex-col" style={{ gap: 5 }}>
                <span style={{ fontSize: 12.5, color: "var(--rd-text-dim)" }}>Faturamento</span>
                <ValorComDetalhe itens={detalhesEntradas} fmt={fmt}>
                  <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1, color: "var(--rd-text)" }}>{fmt(entradasMes)}</span>
                </ValorComDetalhe>
                {deltaFaturamento != null && (
                  <span style={{ fontSize: 12, fontWeight: 600, color: deltaFaturamento >= 0 ? "var(--rd-positive)" : "var(--rd-negative)" }}>
                    {deltaFaturamento >= 0 ? "↗" : "↘"} {Math.abs(deltaFaturamento).toFixed(0)}% vs {rotuloMesAnterior}
                  </span>
                )}
              </div>
              <div className="flex flex-col" style={{ gap: 5 }}>
                <span style={{ fontSize: 12.5, color: "var(--rd-text-dim)" }}>Margem de lucro</span>
                <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1, color: "var(--rd-text)" }}>{margemLucro.toFixed(1)}%</span>
                <span style={{ fontSize: 12, color: "var(--rd-text-dim)" }}>média 12m: {margemMedia12m.toFixed(1)}%</span>
              </div>
            </div>
            <div className="flex flex-col" style={{ gap: 10, paddingBottom: 4 }}>
              <LegendaPonto cor="var(--rd-positive)" label="Entrou" valor={fmt(entradasMes)} itens={detalhesEntradas} fmt={fmt} />
              <LegendaPonto cor="var(--rd-negative)" label="Saiu" valor={fmt(saidasMes)} itens={detalhesSaidas} fmt={fmt} />
              <LegendaPonto cor="var(--rd-attention)" label="A receber" valor={fmt(aReceberMes)} />
            </div>
          </div>

          {/* o próprio gráfico já nomeia e mostra os valores das três linhas do mês
              escolhido, então não repetimos uma legenda solta aqui embaixo */}
          <GraficoCaixa data={chartData} fmt={fmt} />

          <div className="flex items-center flex-wrap" style={{ gap: 20 }}>
            <span style={{ fontSize: 12, color: "var(--rd-text-faint)" }}>toque no gráfico pra ver mês a mês</span>
            <span style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--rd-text-dim)" }}>
              Saldo previsto 12m <strong style={{ color: "var(--rd-brand-light)" }}>{fmt(saldoPrevisto12Meses)}</strong>
            </span>
          </div>
        </div>

        <div
          className="flex flex-col"
          style={{ flex: "1 1 280px", minWidth: 0, background: "var(--rd-surface)", border: "1px solid var(--rd-border)", borderRadius: 16, padding: "22px 24px", gap: 18 }}
        >
          <div className="flex items-center">
            <span style={RD_LABEL}>Frota agora</span>
            <span style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--rd-text-dim)" }}>
              {alugadas} de {motos.length} rodando
            </span>
          </div>

          {motos.length === 0 ? (
            <span style={{ fontSize: 12.5, color: "var(--rd-text-dim)" }}>Nenhuma moto cadastrada ainda.</span>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
              {[...motos]
                .sort((a, b) => (a.status === "alugada" ? 0 : 1) - (b.status === "alugada" ? 0 : 1))
                .map((m) => {
                const alugada = m.status === "alugada";
                const dias = !alugada ? diasParadaDaMoto(m) : null;
                const rotuloValor = alugada
                  ? fmt(m.contratoAtual?.valorMensal || 0)
                  : m.status === "manutencao"
                  ? "oficina"
                  : m.status === "preparacao"
                  ? "preparo"
                  : `${dias ?? 0} dia${dias === 1 ? "" : "s"}`;
                return (
                  <div
                    key={m.id}
                    style={{
                      background: alugada ? "var(--rd-brand)" : "var(--rd-attention-bg-2)",
                      border: alugada ? "none" : "1px solid var(--rd-attention-border)",
                      borderRadius: 10,
                      padding: "11px 8px",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 5,
                      minWidth: 0,
                    }}
                  >
                    <span className="truncate" style={{ maxWidth: "100%", fontFamily: "ui-monospace, monospace", fontSize: 11.5, fontWeight: 600, color: alugada ? "var(--rd-text)" : "var(--rd-attention)" }}>
                      {formatPlaca(m.placa)}
                    </span>
                    <span className="truncate" style={{ maxWidth: "100%", fontSize: 10, color: alugada ? "var(--rd-brand-light)" : "var(--rd-text-dim)" }}>{rotuloValor}</span>
                  </div>
                );
              })}
            </div>
          )}

          {paybackPorMoto.length > 0 && (
            <div className="flex flex-col" style={{ gap: 12, paddingTop: 4, borderTop: "1px solid var(--rd-border-soft)" }}>
              <div className="flex items-baseline flex-wrap" style={{ gap: 8, paddingTop: 14 }}>
                <span style={RD_LABEL}>Payback</span>
                <span style={{ fontSize: 12, color: "var(--rd-text-dim)" }}>quanto falta pra cada moto se pagar</span>
              </div>
              <div className="flex flex-col" style={{ gap: 9 }}>
                {paybackPorMoto.map((r) => {
                  const parada = r.status !== "alugada";
                  const cor = parada ? "var(--rd-negative)" : r.percentPago >= 50 ? "var(--rd-positive)" : r.percentPago >= 15 ? "var(--rd-attention)" : "var(--rd-negative)";
                  return (
                    <div key={r.placa} className="flex items-center" style={{ gap: 12 }}>
                      <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 11.5, color: "var(--rd-text-muted)", width: 66, flex: "none" }}>
                        {formatPlaca(r.placa)}
                      </span>
                      <div style={{ flex: 1 }}>
                        <BarraComCometa pct={r.percentPago} color={cor} />
                      </div>
                      <span style={{ fontSize: 11.5, color: "var(--rd-text-dim)", width: 84, textAlign: "right", flex: "none" }}>
                        {parada ? "parada" : r.jaPagou ? "quitada" : fmt(r.restante)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Faixa 3 — Próximos 7 dias / Onde estão / Do começo */}
      <div className="flex flex-col lg:flex-row" style={{ gap: 18 }}>
        <div
          className="flex flex-col"
          style={{ flex: "1 1 260px", minWidth: 0, background: "var(--rd-surface)", border: "1px solid var(--rd-border)", borderRadius: 16, padding: "20px 22px", gap: 14 }}
        >
          <span style={RD_LABEL}>Próximos 7 dias</span>
          {itens7d.length === 0 ? (
            <span style={{ fontSize: 12.5, color: "var(--rd-text-dim)" }}>Nada previsto pros próximos 7 dias.</span>
          ) : (
            <div className="flex flex-col" style={{ gap: 11 }}>
              {itens7d.map((it, i) => (
                <div key={i} className="flex items-center" style={{ gap: 12 }}>
                  <span className="truncate" style={{ fontSize: 13.5, fontWeight: 500, flex: 1, color: "var(--rd-text)" }}>
                    {it.label}
                  </span>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: it.sinal > 0 ? "var(--rd-brand-light)" : "var(--rd-negative)", flex: "none" }}>
                    {it.sinal > 0 ? "+ " : "− "}
                    {fmt(it.total)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={() => onIrPara?.("rastreio")}
          className="flex flex-col"
          style={{
            flex: "1 1 260px",
            minWidth: 0,
            background: "var(--rd-surface)",
            border: "1px solid var(--rd-border)",
            borderRadius: 16,
            padding: "20px 22px",
            gap: 14,
            textAlign: "left",
          }}
        >
          <div className="flex items-center">
            <span style={RD_LABEL}>Onde estão</span>
            <span style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--rd-text-dim)" }}>ver mapa ›</span>
          </div>
          <div
            style={{
              flex: 1,
              minHeight: 132,
              borderRadius: 12,
              background: "var(--rd-surface-2)",
              border: "1px solid var(--rd-border-soft)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 24,
            }}
          >
            <div className="flex flex-col items-center" style={{ gap: 4 }}>
              <span style={{ fontSize: 28, fontWeight: 700, color: "var(--rd-positive)" }}>{alugadas}</span>
              <span style={{ fontSize: 11, color: "var(--rd-text-dim)" }}>rodando</span>
            </div>
            <div style={{ width: 1, height: 36, background: "var(--rd-border)" }} />
            <div className="flex flex-col items-center" style={{ gap: 4 }}>
              <span style={{ fontSize: 28, fontWeight: 700, color: "var(--rd-attention)" }}>{disponiveis}</span>
              <span style={{ fontSize: 11, color: "var(--rd-text-dim)" }}>paradas</span>
            </div>
          </div>
        </button>

        <div
          className="flex flex-col"
          style={{ flex: "0.8 1 220px", minWidth: 0, background: "var(--rd-surface)", border: "1px solid var(--rd-border)", borderRadius: 16, padding: "20px 22px", gap: 16 }}
        >
          <span style={RD_LABEL}>Do começo</span>
          <div className="flex flex-col" style={{ gap: 13 }}>
            <ValorPequeno label="Investido em frota" valor={fmt(investimentoFrota)} />
            <ValorPequeno label="Já faturado" valor={fmt(faturamentoAcumulado)} cor="var(--rd-brand-light)" />
            <ValorPequeno label="Ticket médio" valor={fmt(ticketMedio)} />
          </div>
        </div>
      </div>
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
        style={{ background: theme.mint, color: theme.mintText, fontWeight: 600, opacity: enviando ? 0.7 : 1 }}
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
        style={{ background: theme.mint, color: theme.mintText, fontWeight: 600, opacity: enviando ? 0.7 : 1 }}
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
function RdBadge({ cor, children }) {
  return (
    <span
      className="flex-shrink-0"
      style={{ fontSize: 11, fontWeight: 700, color: cor, background: "var(--rd-surface)", border: `1px solid ${cor}`, borderRadius: 999, padding: "2px 8px", lineHeight: 1.4 }}
    >
      {children}
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
    <div className="rounded-2xl" style={{ background: "var(--rd-surface)", border: "1px solid var(--rd-border)", padding: "22px 24px" }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
        <span style={RD_LABEL}>Usuários com acesso</span>
        <button
          onClick={() => setModal({ type: "novo" })}
          className="flex items-center"
          style={{ gap: 6, background: "var(--rd-brand-soft)", color: "var(--rd-shell)", borderRadius: 999, padding: "7px 14px", fontSize: 12.5, fontWeight: 700 }}
        >
          <Plus size={14} strokeWidth={3} /> Novo usuário
        </button>
      </div>

      {erro && (
        <div className="flex items-center" style={{ gap: 6, fontSize: 12.5, color: "var(--rd-negative)", marginBottom: 12 }}>
          <AlertTriangle size={13} /> {erro}
        </div>
      )}

      {usuarios === null ? (
        <div className="mbr-skel" style={{ height: 60 }} />
      ) : usuarios.length === 0 ? (
        <div style={{ color: "var(--rd-text-dim)", fontSize: 12.5 }}>Nenhum usuário cadastrado.</div>
      ) : (
        <div className="flex flex-col" style={{ gap: 8 }}>
          {usuarios.map((u) => (
            <div
              key={u.id}
              className="flex items-center justify-between flex-wrap"
              style={{ gap: 8, background: "var(--rd-surface-2)", border: "1px solid var(--rd-border)", borderRadius: 12, padding: "9px 12px" }}
            >
              <div className="flex items-center min-w-0" style={{ gap: 8 }}>
                <span className="truncate" style={{ color: "var(--rd-text)", fontWeight: 600, fontSize: 13.5 }}>
                  {u.username}
                </span>
                {u.role === "admin" ? (
                  <RdBadge cor="var(--rd-attention)">Admin</RdBadge>
                ) : (
                  <RdBadge cor={u.role === "editor" ? "var(--rd-brand-light)" : "var(--rd-text-dim)"}>{u.role === "editor" ? "Editor" : "Visualizador"}</RdBadge>
                )}
                {!u.ativo && <RdBadge cor="var(--rd-negative)">Desativado</RdBadge>}
              </div>
              <div className="flex items-center flex-shrink-0" style={{ marginRight: -8 }}>
                {u.role !== "admin" && (
                  <button
                    onClick={() => alternarRole(u)}
                    className="flex items-center justify-center mbr-hover-grow"
                    style={{ color: "var(--rd-text-muted)", width: 36, height: 36 }}
                    title={u.role === "editor" ? "Trocar pra Visualizador" : "Trocar pra Editor"}
                  >
                    {u.role === "editor" ? <Eye size={15} /> : <Pencil size={15} />}
                  </button>
                )}
                <button
                  onClick={() => setModal({ type: "senha", usuario: u })}
                  className="flex items-center justify-center mbr-hover-grow"
                  style={{ color: "var(--rd-text-muted)", width: 36, height: 36 }}
                  title="Redefinir senha"
                >
                  <KeyRound size={15} />
                </button>
                {u.id !== meuId && (
                  <button
                    onClick={() => excluirUsuario(u)}
                    className="flex items-center justify-center mbr-hover-grow"
                    style={{ color: "var(--rd-text-muted)", width: 36, height: 36 }}
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

  // se outra pessoa (ex. seu pai) mudar as configurações, reflete aqui
  useEffect(() => {
    setLocal(config);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.linkRastreioGeral]);

  const salvarAgora = async (next) => {
    setStatus({ text: "Salvando...", kind: "" });
    await persist(next);
    setStatus({ text: "Salvo ✓", kind: "ok" });
    setTimeout(() => setStatus({ text: "", kind: "" }), 1800);
  };

  return (
    <div className="flex flex-col" style={{ gap: 14, fontFamily: "var(--rd-font)" }}>
      <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--rd-text)" }}>Ajustes</h1>

      <div
        className="rounded-2xl flex items-center justify-between flex-wrap"
        style={{ gap: 12, background: "var(--rd-surface)", border: "1px solid var(--rd-border)", padding: "16px 20px" }}
      >
        <div className="min-w-0">
          <div style={{ color: "var(--rd-text-dim)", fontSize: 12 }}>Logado como</div>
          <div className="flex items-center truncate" style={{ gap: 6, color: "var(--rd-text)", fontWeight: 600, fontSize: 14.5 }}>
            {perfil?.username}
            {perfil?.role === "admin" && <ShieldCheck size={14} color="var(--rd-attention)" />}
          </div>
        </div>
        <button
          onClick={onSignOut}
          className="flex items-center flex-shrink-0"
          style={{ gap: 7, background: "var(--rd-surface-2)", border: "1px solid var(--rd-border)", color: "var(--rd-negative)", borderRadius: 999, padding: "9px 16px", fontSize: 12.5, fontWeight: 700 }}
        >
          <LogOut size={14} /> Sair
        </button>
      </div>

      {perfil?.role === "admin" && <UsuariosSection meuId={perfil.id} />}

      {permissoes.podeEditar && (
        <div className="rounded-2xl" style={{ background: "var(--rd-surface)", border: "1px solid var(--rd-border)", padding: "22px 24px" }}>
          <span style={RD_LABEL}>Link de rastreio (aba Rastreamento)</span>
          <input
            style={{
              width: "100%",
              background: "var(--rd-surface-2)",
              border: "1px solid var(--rd-border)",
              borderRadius: 10,
              padding: "10px 14px",
              color: "var(--rd-text)",
              fontSize: 13.5,
              fontFamily: "var(--rd-font)",
              marginTop: 10,
              marginBottom: 8,
            }}
            value={local.linkRastreioGeral || ""}
            onChange={(e) => setLocal((l) => ({ ...l, linkRastreioGeral: e.target.value }))}
            onBlur={() => salvarAgora(local)}
            placeholder="https://web.melocaliza.com.br/sharing/..."
          />
          <div style={{ fontSize: 12, color: "var(--rd-text-dim)" }}>
            Na Melocaliza: Compartilhar localização → Novo → selecione todas as motos → validade "Nenhum" → copie o link.
          </div>
        </div>
      )}

      {status.text && (
        <div
          className="inline-block"
          style={{
            fontSize: 12.5,
            fontWeight: 700,
            borderRadius: 999,
            padding: "7px 14px",
            alignSelf: "flex-start",
            color: status.kind === "erro" ? "var(--rd-negative)" : "var(--rd-positive)",
            background: status.kind === "erro" ? "var(--rd-attention-bg)" : "#132018",
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
          style={{ background: theme.mint, color: theme.mintText, fontWeight: 600, opacity: enviando ? 0.7 : 1 }}
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
          style={{ background: theme.mint, color: theme.mintText, fontWeight: 600, opacity: enviando ? 0.7 : 1 }}
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

  // "Frota" é a única aba com contador de pendência por enquanto — motos disponíveis
  // (paradas) são a mesma condição que a Etapa 3 (Visão geral) vai usar na faixa
  // "Precisa de você"
  const motosParadas = motosState.items.filter((m) => m.status === "disponivel").length;

  const tabs = [
    { id: "dashboard", label: "Visão geral", labelMobile: "Painel", icon: LayoutDashboard },
    { id: "motos", label: "Frota", labelMobile: "Frota", icon: Bike, pendente: motosParadas > 0 ? motosParadas : null },
    { id: "clientes", label: "Clientes", labelMobile: "Clientes", icon: Users },
    { id: "fluxo", label: "Caixa", labelMobile: "Caixa", icon: Wallet },
    { id: "rastreio", label: "Rastreamento", labelMobile: "Mapa", icon: Navigation },
  ];
  const abaAtual = tabs.find((t) => t.id === tab);
  const tituloTela = abaAtual ? abaAtual.label : "Ajustes";
  const dataCabecalho = useMemo(() => {
    const texto = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }, []);

  return (
    <div
      style={{
        background: "var(--rd-shell)",
        minHeight: "100vh",
        fontFamily: "var(--rd-font)",
      }}
    >
      <style>{`
        ${fontImport}
        * { -webkit-tap-highlight-color: transparent; }
        button { transition: opacity 0.15s ease, transform 0.16s ease, filter 0.15s ease; cursor: pointer; border: none; }
        button:active { transform: scale(0.97); opacity: 0.85; }
        .mbr-hover-grow { transform-origin: center; }
        .mbr-tab-icon { transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1); }
        .mbr-card-lift { transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.28s ease; will-change: transform; }
        .mbr-nav-item { transition: background 0.15s ease, color 0.15s ease; }
        @media (hover: hover) and (pointer: fine) {
          button:hover { filter: brightness(1.22); }
          .mbr-nav-item:hover { filter: none; background: var(--rd-surface); }
          .mbr-nav-item[data-active="true"]:hover { filter: none; background: var(--rd-brand); }
          .mbr-hover-grow:hover { transform: scale(1.16); filter: brightness(1.28); }
          .mbr-card-lift:hover { transform: translateY(-1px); box-shadow: 0 4px 14px rgba(0,0,0,0.24); }
        }
        input, select, textarea, button { font-family: var(--rd-font); }
        input:focus, select:focus, textarea:focus, button:focus-visible {
          outline: 2px solid var(--rd-brand-soft); outline-offset: 2px;
        }
        @media (prefers-reduced-motion: reduce) {
          * { transition: none !important; animation: none !important; }
        }
        @keyframes mbrPulse { 0%, 100% { opacity: 0.45; } 50% { opacity: 0.9; } }
        .mbr-skel { animation: mbrPulse 1.3s ease-in-out infinite; border-radius: 10px; background: var(--rd-surface); }
        @keyframes mbrFadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .mbr-fade-in { animation: mbrFadeIn 0.24s ease both; }
        @keyframes mbrRotuloTroca { from { opacity: 0; } to { opacity: 1; } }
        .mbr-rotulo-troca { animation: mbrRotuloTroca 0.22s ease both; animation-delay: 0.08s; }

        /* shell — sidebar fixa ≥1024px, tab bar embaixo <1024px (mobirelli-redesign-spec.md, seção 2) */
        .mbr-desktop-only { display: none; }
        .mbr-mobile-only { display: flex; }
        .mbr-desktop-grid { display: none; }
        .mbr-main-pad-bottom { padding-bottom: calc(84px + env(safe-area-inset-bottom, 0px)); }
        @media (min-width: 1024px) {
          .mbr-desktop-only { display: flex; }
          .mbr-mobile-only { display: none; }
          .mbr-desktop-grid { display: grid; }
          .mbr-main-pad-bottom { padding-bottom: 32px; }
        }

        /* -----------------------------------------------------------
           TABELAS — o cabeçalho e a linha compartilham a MESMA classe de
           grade e a MESMA calha lateral. Era exatamente isso que faltava:
           o cabeçalho tinha 4px de calha e a linha 18px, então nenhum
           rótulo caía em cima da coluna que ele nomeia. O +1px do
           cabeçalho compensa a borda de 1px do cartão da linha.
        ----------------------------------------------------------- */
        .mbr-tab-head {
          padding: 0 calc(var(--rd-pad-row-x) + 1px) 10px;
          column-gap: var(--rd-gap-col);
          border-bottom: 1px solid var(--rd-border-soft);
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--rd-text-faint);
        }
        .mbr-tab-row {
          padding: var(--rd-pad-row-y) var(--rd-pad-row-x);
          column-gap: var(--rd-gap-col);
          align-items: center;
        }

        /* "Onde está" é a única coluna que sai quando a tela aperta (<1280px) —
           é a informação mais dispensável da linha. Payback fica SEMPRE visível:
           é número de acompanhamento diário, não pode sumir no tablet */
        .mbr-col-extra { display: none !important; }
        @media (min-width: 1280px) {
          .mbr-col-extra { display: flex !important; }
        }

        .mbr-grid-frota { grid-template-columns: 116px minmax(0, 1.4fr) 124px 112px minmax(0, 1fr) 80px; }
        @media (min-width: 1280px) {
          .mbr-grid-frota { grid-template-columns: 116px minmax(0, 1.5fr) 124px 112px minmax(0, 0.9fr) 132px 80px; }
        }
        .mbr-grid-clientes { grid-template-columns: minmax(0, 1.15fr) 150px minmax(0, 1fr) 168px 76px; }

        /* grupo de filtros/abas em pílula — no celular quatro pílulas não cabem
           lado a lado, e como o grupo não encolhia ele empurrava a página inteira
           pro lado. Aqui ele vira uma faixa que rola sozinha, sem barra à vista */
        .mbr-filtros {
          display: flex;
          gap: 2px;
          background: var(--rd-surface-2);
          border: 1px solid var(--rd-border);
          border-radius: 999px;
          padding: 4px;
          max-width: 100%;
          overflow-x: auto;
          scrollbar-width: none;
          -ms-overflow-style: none;
          -webkit-overflow-scrolling: touch;
        }
        .mbr-filtros::-webkit-scrollbar { display: none; }
        .mbr-filtros > button { flex: none; white-space: nowrap; }
      `}</style>

      <div style={{ display: "flex", alignItems: "flex-start" }}>
        {/* SIDEBAR — desktop ≥1024px */}
        <nav
          className="mbr-desktop-only"
          style={{
            flexDirection: "column",
            gap: 26,
            width: 232,
            flex: "none",
            position: "sticky",
            top: 0,
            height: "100vh",
            background: "var(--rd-sidebar)",
            borderRight: "1px solid var(--rd-border-soft)",
            padding: "22px 16px",
          }}
        >
          <div className="flex items-center" style={{ gap: 11, padding: "0 8px" }}>
            <MarcaMobirelli size={38} raio={11} />
            <div className="flex flex-col" style={{ gap: 3 }}>
              <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1, color: "var(--rd-text)" }}>mobirelli</span>
              <LinhaMarca />
            </div>
          </div>

          <div className="flex flex-col" style={{ gap: 3 }}>
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: "var(--rd-text-faint)",
                padding: "0 10px 8px",
              }}
            >
              Operação
            </span>
            {tabs.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  data-active={active}
                  className="mbr-nav-item flex items-center"
                  style={{
                    gap: 11,
                    padding: 10,
                    borderRadius: 11,
                    background: active ? "var(--rd-brand)" : "transparent",
                    color: active ? "#F0F5EE" : "var(--rd-text-muted)",
                    fontWeight: active ? 600 : 500,
                    textAlign: "left",
                  }}
                >
                  <Icon size={17} strokeWidth={2.75} />
                  <span style={{ fontSize: 14 }}>{t.label}</span>
                  {t.pendente ? (
                    <span
                      style={{
                        marginLeft: "auto",
                        fontSize: 11.5,
                        fontWeight: 700,
                        color: "var(--rd-attention)",
                        background: "#2A2115",
                        borderRadius: 999,
                        padding: "2px 8px",
                      }}
                    >
                      {t.pendente}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="flex flex-col" style={{ gap: 3, marginTop: "auto" }}>
            <button
              onClick={() => setTab("config")}
              data-active={tab === "config"}
              className="mbr-nav-item flex items-center"
              style={{
                gap: 11,
                padding: 10,
                borderRadius: 11,
                background: tab === "config" ? "var(--rd-brand)" : "transparent",
                color: tab === "config" ? "#F0F5EE" : "#8A9A8C",
                textAlign: "left",
              }}
            >
              <Settings size={17} strokeWidth={2.75} />
              <span style={{ fontSize: 14, fontWeight: tab === "config" ? 600 : 500 }}>Ajustes</span>
            </button>
            <div className="flex items-center" style={{ gap: 10, padding: 10, borderTop: "1px solid var(--rd-border-soft)", marginTop: 8, minWidth: 0 }}>
              <AvatarIniciais username={perfil?.username} />
              <span className="truncate" style={{ fontSize: 13, fontWeight: 500, color: "var(--rd-text-muted)" }}>
                {perfil?.username}
              </span>
            </div>
          </div>
        </nav>

        {/* COLUNA DE CONTEÚDO */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            ...(tab === "rastreio" ? { height: "100vh", overflow: "hidden", position: "relative" } : {}),
          }}
        >
          {/* no Rastreamento o header flutua ABSOLUTO por cima do mapa (que ocupa a
              coluna inteira, de ponta a ponta) — é isso que faz o degradê do header
              realmente se misturar com o mapa por trás, em vez de só desenhar um
              header sólido em cima de uma faixa vazia. Nas outras abas ele continua
              sticky, empurrando o conteúdo normalmente */}
          <div ref={headerRef} style={tab === "rastreio" ? { position: "absolute", top: 0, left: 0, right: 0, zIndex: 40 } : { position: "sticky", top: 0, zIndex: 40 }}>
            {/* header de conteúdo — desktop */}
            <header
              className="mbr-desktop-only"
              style={{
                alignItems: "center",
                gap: 16,
                padding: "20px 28px",
                position: "relative",
                background:
                  tab === "rastreio" ? `linear-gradient(to bottom, ${hexToRgba("#0E1512", 0.92)} 0%, ${hexToRgba("#0E1512", 0.92)} 55%, ${hexToRgba("#0E1512", 0)} 100%)` : "var(--rd-shell)",
                borderBottom: tab === "rastreio" ? "none" : "1px solid var(--rd-border-soft)",
              }}
            >
              {tab === "rastreio" && <BorraProgressiva lado="topo" />}
              <div className="flex flex-col" style={{ gap: 3 }}>
                <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--rd-text)" }}>{tituloTela}</h1>
                <span style={{ fontSize: 12.5, color: "var(--rd-text-dim)" }}>{dataCabecalho}</span>
              </div>
              {anyError && (
                <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--rd-negative)" }}>{anyError}</span>
              )}
            </header>

            {/* header compacto — mobile/tablet (<1024px) */}
            <header
              className="mbr-mobile-only"
              style={{
                alignItems: "center",
                gap: 12,
                padding: "16px 20px",
                position: "relative",
                paddingTop: "calc(16px + env(safe-area-inset-top, 0px))",
                background:
                  tab === "rastreio" ? `linear-gradient(to bottom, ${hexToRgba("#0E1512", 0.92)} 0%, ${hexToRgba("#0E1512", 0.92)} 55%, ${hexToRgba("#0E1512", 0)} 100%)` : "var(--rd-shell)",
                borderBottom: tab === "rastreio" ? "none" : "1px solid var(--rd-border-soft)",
              }}
            >
              {tab === "rastreio" && <BorraProgressiva lado="topo" />}
              <MarcaMobirelli size={32} raio={9} />
              <div className="flex flex-col" style={{ gap: 1, minWidth: 0 }}>
                <span className="truncate" style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--rd-text)" }}>
                  {tituloTela}
                </span>
                <span className="truncate" style={{ fontSize: 11.5, color: "var(--rd-text-dim)" }}>
                  {dataCabecalho}
                </span>
              </div>
              <button
                onClick={() => setTab("config")}
                aria-label="Ajustes"
                title="Ajustes"
                style={{
                  marginLeft: "auto",
                  width: 34,
                  height: 34,
                  borderRadius: 999,
                  background: "var(--rd-surface-2)",
                  border: "1px solid var(--rd-border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--rd-text-muted)",
                  flex: "none",
                }}
              >
                <Settings size={16} strokeWidth={2.75} />
              </button>
            </header>
          </div>

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
            className={tab === "rastreio" ? "" : "mbr-main-pad-bottom px-4 sm:px-8 pt-5 max-w-5xl mx-auto lg:max-w-7xl"}
            // width:100% + minWidth:0 são obrigatórios aqui. O <main> tem "mx-auto" (margem
            // lateral automática, pra centralizar), e margem automática no eixo cruzado
            // DESLIGA o stretch do flex: sem largura explícita, o <main> passa a se medir
            // pelo próprio conteúdo (min-content) e ignora a largura da janela. Era isso
            // que empurrava a página toda pro lado no celular — o <main> ficava com 494px
            // numa tela de 390px, e o site inteiro ia junto. Com width:100% ele volta a
            // obedecer a coluna, e o "max-w-*" continua limitando no desktop.
            style={tab === "rastreio" ? { position: "absolute", inset: 0 } : { width: "100%", minWidth: 0 }}
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
              <DashboardView
                motos={motosState.items}
                lancamentos={fluxoState.items}
                clientes={clientesState.items}
                futuros={futurosState.items}
                config={configState.value}
                onIrPara={setTab}
              />
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
        </div>

        {/* TAB BAR — mobile/tablet (<1024px) */}
        <nav
          ref={navRef}
          className="mbr-mobile-only fixed bottom-0 left-0 right-0 z-40 items-center justify-around"
          style={{
            padding: "12px 16px",
            paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0px))",
            background:
              tab === "rastreio" ? `linear-gradient(to bottom, ${hexToRgba("#0B110E", 0)} 0%, ${hexToRgba("#0B110E", 0.94)} 45%, ${hexToRgba("#0B110E", 0.94)} 100%)` : "var(--rd-sidebar)",
            borderTop: tab === "rastreio" ? "none" : "1px solid var(--rd-border-soft)",
          }}
        >
          {tab === "rastreio" && <BorraProgressiva lado="base" />}
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-label={t.labelMobile}
                title={t.labelMobile}
                className="flex flex-col items-center"
                style={{ gap: 5, background: "none", position: "relative", color: active ? "var(--rd-brand-light)" : "var(--rd-text-faint)" }}
              >
                <Icon size={21} strokeWidth={2.75} className="mbr-tab-icon" />
                <span style={{ fontSize: 10, fontWeight: active ? 700 : 600 }}>{t.labelMobile}</span>
                {t.pendente ? (
                  <span
                    style={{
                      position: "absolute",
                      top: -3,
                      right: 2,
                      width: 7,
                      height: 7,
                      borderRadius: 999,
                      background: "var(--rd-attention)",
                    }}
                  />
                ) : null}
              </button>
            );
          })}
        </nav>
      </div>
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
