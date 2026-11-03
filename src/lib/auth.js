import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabaseClient";

const DOMINIO_EMAIL = "mobirelli.local";
const emailDoUsuario = (username) => `${username.trim().toLowerCase()}@${DOMINIO_EMAIL}`;

/**
 * Login com usuário e senha — por baixo dos panos usa o Supabase Auth (email/senha),
 * só que escondendo o email: cada "usuário" vira usuario@mobirelli.local sozinho.
 */
export async function signIn(username, senha) {
  const { error } = await supabase.auth.signInWithPassword({ email: emailDoUsuario(username), password: senha });
  if (error) return { ok: false, erro: "Usuário ou senha incorretos." };
  return { ok: true };
}

export async function signOut() {
  await supabase.auth.signOut();
}

/**
 * Troca a senha de quem está logado agora (ao contrário de "redefinir-senha" de
 * outra pessoa, essa não passa pela function serverless — o próprio Supabase Auth
 * já deixa qualquer usuário trocar a própria senha, sem precisar de service role key).
 */
export async function alterarMinhaSenha(senha) {
  const { error } = await supabase.auth.updateUser({ password: senha });
  if (error) return { ok: false, erro: "Não foi possível trocar a senha agora." };
  return { ok: true };
}

/**
 * Chama a função serverless api/admin-usuarios.js já anexando o token da sessão atual —
 * usada tanto pra criar o primeiro administrador quanto pelas ações da tela de Usuários.
 */
export async function chamarAdminApi(action, payload) {
  const { data: sessaoData } = await supabase.auth.getSession();
  const token = sessaoData?.session?.access_token;
  try {
    const resp = await fetch("/api/admin-usuarios", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ action, ...payload }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return { ok: false, erro: data?.erro || "Não foi possível completar a ação agora." };
    return { ok: true, ...data };
  } catch {
    return { ok: false, erro: "Falha de conexão. Tente de novo." };
  }
}

/**
 * Lista todo mundo que tem login (usado na tela de Usuários, só admin) — id, usuário,
 * se é admin, se está ativo. Nunca traz senha (ela nem existe fora de auth.users).
 */
export async function listarUsuarios() {
  const { data, error } = await supabase.from("perfis").select("id, username, role, ativo, created_at").order("created_at");
  if (error) return { ok: false, erro: "Não foi possível carregar os usuários agora." };
  return { ok: true, usuarios: data || [] };
}

/**
 * Rastreia a sessão atual (e reage a login/logout em tempo real), busca o perfil
 * correspondente em "perfis" (usuário, role, ativo), e informa se já existe algum
 * administrador cadastrado — usado pra decidir entre a tela de login normal e a tela de
 * "criar administrador" (só aparece uma vez, no primeiro acesso de todos).
 */
export function useAuth() {
  const [session, setSession] = useState(null);
  const [perfil, setPerfil] = useState(null);
  const [loading, setLoading] = useState(true);
  const [adminExiste, setAdminExiste] = useState(null);

  const carregarPerfil = useCallback(async (uid) => {
    if (!uid) {
      setPerfil(null);
      return;
    }
    const { data } = await supabase.from("perfis").select("id, username, role, ativo").eq("id", uid).maybeSingle();
    setPerfil(data || null);
    // se o acesso da pessoa foi removido enquanto ela estava logada, desloga na hora
    if (data && !data.ativo) {
      await supabase.auth.signOut();
    }
  }, []);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const { count } = await supabase.from("perfis").select("id", { count: "exact", head: true }).eq("role", "admin");
      if (!cancelado) setAdminExiste((count || 0) > 0);
    })();
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelado = false;
    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelado) return;
      setSession(data.session);
      await carregarPerfil(data.session?.user?.id);
      if (!cancelado) setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange(async (_evento, novaSessao) => {
      setSession(novaSessao);
      await carregarPerfil(novaSessao?.user?.id);
      setLoading(false);
      // uma conta acabou de ser criada (bootstrap ou pela tela de Usuários) — se antes
      // não existia nenhum admin, agora existe
      if (novaSessao) setAdminExiste(true);
    });
    return () => {
      cancelado = true;
      listener.subscription.unsubscribe();
    };
  }, [carregarPerfil]);

  return { session, perfil, loading, adminExiste };
}
