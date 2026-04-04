import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { LimitedOfferBar } from "@/components/LimitedOfferBar";
import { fetchProfileLite } from "@/lib/fetch-profile-api";
import { normalizeInstagramUsername } from "@/lib/instagram-username";
import { sortPackagesLikeWhatsappList } from "@/lib/whatsapp-follower-packages";
import { cn } from "@/lib/utils";
import { Loader2, Instagram, ArrowRight, Search } from "lucide-react";

const rawProfileMs = Number(import.meta.env.VITE_PROFILE_FETCH_TIMEOUT_MS);
const PROFILE_FETCH_MS = Number.isFinite(rawProfileMs)
  ? Math.min(Math.max(rawProfileMs, 8_000), 30_000)
  : 12_000;
interface PackageData {
  id: string;
  quantity: number;
  price: number;
  discount_price: number | null;
}

export default function Index() {
  const navigate = useNavigate();
  const usernameInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"username" | "packages">("username");
  const [username, setUsername] = useState("");
  const [profilePic, setProfilePic] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [packages, setPackages] = useState<PackageData[]>([]);
  const [packagesLoading, setPackagesLoading] = useState(false);

  const fetchProfile = async () => {
    const user = normalizeInstagramUsername(username);
    if (!user) return;

    setProfileLoading(true);
    setProfileError("");
    usernameInputRef.current?.blur();

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), PROFILE_FETCH_MS);

    try {
      const result = await fetchProfileLite(user, { signal: ac.signal });
      if (result.ok) {
        const data = result.data;
        usernameInputRef.current?.blur();
        if (typeof document !== "undefined") {
          const ae = document.activeElement;
          if (ae instanceof HTMLElement) ae.blur();
        }
        setProfilePic((typeof data.profile_pic === "string" && data.profile_pic) || null);
        setUsername(user);
        loadPackages();
        setStep("packages");
      } else {
        setProfileError(result.error);
      }
    } catch {
      setProfileError("Erro inesperado ao buscar perfil. Tente novamente.");
    } finally {
      clearTimeout(timer);
      setProfileLoading(false);
    }
  };

  const loadPackages = async () => {
    setPackagesLoading(true);
    const { data, error } = await supabase
      .from("packages")
      .select("*")
      .eq("kind", "followers")
      .eq("active", true)
      .order("quantity", { ascending: true });

    if (!error && data) setPackages(sortPackagesLikeWhatsappList(data));
    setPackagesLoading(false);
  };

  const handleSelectPackage = (pkg: PackageData) => {
    navigate(`/${pkg.quantity}=${username}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") fetchProfile();
  };

  const formatPrice = (cents: number) =>
    `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;

  return (
    <div
      className={cn(
        "flex w-full min-w-0 max-w-full flex-col items-center overflow-x-hidden px-4",
        /* Celular: altura = viewport pequena (svh), sem min-h 100dvh + pb-32 que geravam rolagem no vazio */
        "h-[100svh] max-h-[100svh]",
        step === "packages" ? "overflow-y-auto" : "overflow-y-hidden",
        /* Espaço para LimitedOfferBar fixa no topo (safe-area + altura da faixa ~3.25–3.5rem) */
        "pt-[calc(env(safe-area-inset-top,0px)+3.5rem)] pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]",
        "md:h-auto md:max-h-none md:min-h-[100dvh] md:overflow-y-visible md:justify-start md:gap-10 md:pb-32 md:pt-[calc(env(safe-area-inset-top,0px)+5.75rem)] lg:pt-[calc(env(safe-area-inset-top,0px)+6.25rem)]",
      )}
    >
      {/* Mobile: hero + card centralizados na tela; desktop: fluxo normal de cima para baixo */}
      <div
        className={cn(
          "flex w-full flex-col items-center",
          step === "username" &&
            "min-h-0 flex-1 justify-center gap-5 overflow-hidden md:flex-none md:justify-start md:gap-10 md:overflow-visible",
        )}
      >
      {step === "username" && (
        <header className="w-full min-w-0 max-w-lg shrink-0 text-center select-text sm:max-w-xl md:mx-auto md:max-w-3xl">
          <h1 className="text-balance text-xl font-extrabold leading-snug tracking-tight text-primary sm:text-2xl md:text-[2rem] md:leading-[1.2] lg:text-4xl">
            Transforme seu perfil em uma máquina de engajamento e autoridade
          </h1>
          <p className="text-pretty mx-auto mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base md:mt-3 md:text-lg">
            Atraia marcas, empresas e clientes que querem investir no seu sucesso.
          </p>
        </header>
      )}

      <section
        className="w-full min-w-0 max-w-md mx-auto rounded-xl border border-border bg-card shadow-xl shadow-black/40 overflow-hidden relative z-10 box-border"
        aria-label="Comprar seguidores"
      >
          {step === "username" && (
            <div className="flex flex-col p-6 gap-5">
              {/* Header */}
              <div className="text-center space-y-2">
                <div className="w-16 h-16 mx-auto rounded-full gradient-instagram flex items-center justify-center">
                  <Instagram className="h-8 w-8 text-primary-foreground" />
                </div>
                <h2 className="text-xl font-bold text-foreground">Comprar Seguidores</h2>
                <p className="text-sm text-muted-foreground">
                  Para qual perfil você deseja comprar seguidores?
                </p>
              </div>

              {/* Input */}
              <div className="space-y-3">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">@</span>
                  <input
                    ref={usernameInputRef}
                    type="text"
                    inputMode="text"
                    autoComplete="username"
                    enterKeyHint="search"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="nome.de.usuario"
                    className="w-full bg-muted border border-border rounded-lg pl-8 pr-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/60 focus:border-primary/50"
                  />
                </div>

                {profileError && (
                  <p className="text-xs text-destructive text-center">{profileError}</p>
                )}

                <button
                  onClick={fetchProfile}
                  disabled={!username.trim() || profileLoading}
                  className="w-full gradient-instagram text-primary-foreground font-bold py-3 rounded-lg flex items-center justify-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {profileLoading ? (
                    <><Loader2 className="h-5 w-5 animate-spin" /> Buscando perfil...</>
                  ) : (
                    <><Search className="h-5 w-5" /> Buscar perfil</>
                  )}
                </button>
              </div>
            </div>
          )}

          {step === "packages" && (
            <div className="flex flex-col">
              {/* Profile header */}
              <div className="px-6 pt-6 pb-4 flex items-center gap-3">
                {profilePic && (
                  <img
                    src={profilePic}
                    alt={username}
                    className="w-12 h-12 rounded-full object-cover border-2 border-border"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                )}
                <div>
                  <p className="text-base font-bold text-foreground">@{username}</p>
                  <button
                    onClick={() => { setStep("username"); setProfilePic(null); }}
                    className="text-xs text-primary hover:underline"
                  >
                    Trocar perfil
                  </button>
                </div>
              </div>

              <div className="px-6 pb-2">
                <h3 className="text-sm font-bold text-foreground">Escolha um pacote</h3>
              </div>

              {/* Packages list */}
              <div className="px-6 pb-6">
                {packagesLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="space-y-2">
                    {packages.map((pkg) => (
                      <button
                        key={pkg.id}
                        onClick={() => handleSelectPackage(pkg)}
                        className="w-full flex items-center justify-between bg-muted hover:bg-muted/80 border border-border rounded-lg px-4 py-3 transition-colors group"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full gradient-instagram flex items-center justify-center text-primary-foreground text-xs font-bold">
                            {pkg.quantity >= 1000 ? `${pkg.quantity / 1000}K` : pkg.quantity}
                          </div>
                          <div className="text-left">
                            <p className="text-sm font-semibold text-foreground">
                              {pkg.quantity.toLocaleString("pt-BR")} seguidores
                            </p>
                            {pkg.discount_price && (
                              <p className="text-xs text-muted-foreground line-through">
                                {formatPrice(pkg.price)}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-primary">
                            {formatPrice(pkg.discount_price ?? pkg.price)}
                          </span>
                          <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
      </section>
      </div>

      <LimitedOfferBar />
    </div>
  );
}
