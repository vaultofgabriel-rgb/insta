import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PaymentModal } from "@/components/PaymentModal";
import { fetchProfileLite } from "@/lib/fetch-profile-api";
import { normalizeInstagramUsername } from "@/lib/instagram-username";
import {
  computeChoppedPackagePrice,
  type ChoppedPackageInput,
} from "@/lib/chopped-package-price";
import { Loader2 } from "lucide-react";

const rawProfileMs = Number(import.meta.env.VITE_PROFILE_FETCH_TIMEOUT_MS);
const PROFILE_FETCH_MS = Number.isFinite(rawProfileMs)
  ? Math.min(Math.max(rawProfileMs, 8_000), 30_000)
  : 12_000;

interface ProfileData {
  ok: boolean;
  username: string;
  full_name: string;
  followers: number;
  following: number;
  profile_pic: string;
  posts: string[];
}

export default function PurchasePage() {
  const { slug } = useParams<{ slug: string }>();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [isDiscounted, setIsDiscounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [quantity, setQuantity] = useState(0);
  /** Centavos: cálculo local a partir de packages (quantidade exata na tabela = preço da linha). */
  const [followerAmountCents, setFollowerAmountCents] = useState(0);
  const [showPayment, setShowPayment] = useState(false);

  const fetchProfile = async (user: string): Promise<boolean> => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), PROFILE_FETCH_MS);
    try {
      const result = await fetchProfileLite(user, { signal: ac.signal });
      if (result.ok) {
        const data = result.data;
        const fw = Number(data.followers);
        const fg = Number(data.following);
        setProfile({
          ...data,
          followers: Number.isFinite(fw) && fw >= 0 ? Math.round(fw) : 0,
          following: Number.isFinite(fg) && fg >= 0 ? Math.round(fg) : 0,
          posts: Array.isArray(data.posts) ? data.posts : [],
        } as ProfileData);
        return true;
      }
      setError(result.error);
      return false;
    } catch {
      setError("Erro inesperado ao buscar perfil.");
      return false;
    } finally {
      clearTimeout(timer);
    }
  };

  const fetchFollowerPrice = async (requestedQty: number, preferDiscount: boolean): Promise<boolean> => {
    const serviceId =
      typeof import.meta.env.VITE_FOLLOWERS_SERVICE_ID === "string"
        ? import.meta.env.VITE_FOLLOWERS_SERVICE_ID.trim() || null
        : null;

    const applyRow = (row: { amount_cents: number }) => {
      setFollowerAmountCents(row.amount_cents);
      setQuantity(requestedQty);
    };

    // Sempre calcula a partir da tabela packages (igual ao TS em chopped-package-price.ts).
    // Não usa RPC aqui: a função SQL no projeto pode estar desatualizada e travar em R$ 22,08 para /300=.
    const { data: pkgs, error: pkgErr } = await supabase
      .from("packages")
      .select("id, quantity, price, discount_price, kind, active")
      .eq("active", true);

    if (pkgErr || !pkgs?.length) {
      setError(
        import.meta.env.DEV
          ? (pkgErr?.message ?? "Sem pacotes")
          : "Não foi possível calcular o preço. Verifique os pacotes no painel.",
      );
      return false;
    }

    try {
      const chop = computeChoppedPackagePrice(
        pkgs as ChoppedPackageInput[],
        requestedQty,
        "followers",
        preferDiscount,
        serviceId,
      );
      applyRow(chop);
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Pacote inválido.";
      setError(msg);
      return false;
    }
  };

  useEffect(() => {
    if (!slug) return;

    const eqIndex = slug.indexOf("=");
    if (eqIndex === -1) {
      setError("Link inválido");
      setLoading(false);
      return;
    }

    const qtyPart = slug.substring(0, eqIndex);
    const user = normalizeInstagramUsername(slug.substring(eqIndex + 1));
    setUsername(user);

    const discounted = qtyPart.includes("_");
    setIsDiscounted(discounted);
    const qty = parseInt(qtyPart.split("_")[0], 10);
    setQuantity(qty);

    if (isNaN(qty) || !user) {
      setError("Link inválido");
      setLoading(false);
      return;
    }

    let cancelled = false;
    Promise.all([fetchProfile(user), fetchFollowerPrice(qty, discounted)])
      .then(([profileOk, priceOk]) => {
        if (cancelled) return;
        if (profileOk && priceOk) {
          setShowPayment(true);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Erro ao carregar página. Tente novamente.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-5">
        <div className="relative w-20 h-20">
          <div className="absolute inset-0 rounded-full gradient-instagram animate-spin" style={{ 
            mask: 'radial-gradient(farthest-side, transparent calc(100% - 4px), black calc(100% - 4px))',
            WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 4px), black calc(100% - 4px))'
          }} />
          <div className="absolute inset-2 rounded-full bg-background flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </div>
        <div className="text-center space-y-2">
          <h1 className="text-xl font-bold">
            <span className="text-primary">Fama 24H</span>
            <span className="text-foreground"> Engajamento</span>
          </h1>
          <p className="text-sm text-foreground">
            Preparando pedido para <span className="text-primary font-semibold">@{username}</span>
          </p>
          <p className="text-xs text-muted-foreground animate-pulse">Buscando perfil...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-3">
          <h1 className="text-2xl font-bold text-primary">Erro</h1>
          <p className="text-muted-foreground">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="text-sm text-primary hover:underline"
          >
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <PaymentModal
        open={showPayment}
        username={username}
        quantity={quantity}
        amount={followerAmountCents}
        isDiscounted={isDiscounted}
        profilePic={profile?.profile_pic}
        profileFollowers={
          profile && Number.isFinite(profile.followers) && profile.followers >= 0
            ? profile.followers
            : undefined
        }
      />
    </div>
  );
}
