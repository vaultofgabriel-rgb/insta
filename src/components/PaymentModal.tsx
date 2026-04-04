import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from "@supabase/supabase-js";
import PixQRCode from "react-qr-code";
import { generateFakeCustomer } from "@/lib/fake-customer";
import { Loader2, Copy, Check, X, CheckCircle, PartyPopper, QrCode } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { metaPixelInitiateCheckout, metaPixelPurchase } from "@/lib/meta-pixel";

interface PaymentModalProps {
  open: boolean;
  username: string;
  quantity: number;
  amount: number;
  isDiscounted: boolean;
  profilePic?: string;
  /** Contagem vinda da API de perfil (aproximada). */
  profileFollowers?: number;
}

export function PaymentModal({
  open,
  username,
  quantity,
  amount,
  isDiscounted,
  profilePic,
  profileFollowers,
}: PaymentModalProps) {
  const [paymentMethod, setPaymentMethod] = useState<"choosing" | "pix">("choosing");
  const [status, setStatus] = useState<"generating" | "ready" | "confirmed" | "error">("generating");
  const [pixCode, setPixCode] = useState("");
  const [pixQrBase64, setPixQrBase64] = useState("");
  const [pixGateway, setPixGateway] = useState<string | null>(null);
  const [pixErrorMessage, setPixErrorMessage] = useState<string>("");
  const [orderId, setOrderId] = useState("");
  const [copied, setCopied] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const purchaseTrackedOrderIdsRef = useRef(new Set<string>());

  const resetModal = useCallback(() => {
    purchaseTrackedOrderIdsRef.current.clear();
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = null;
    setPaymentMethod("choosing");
    setStatus("generating");
    setPixCode("");
    setPixQrBase64("");
    setPixGateway(null);
    setPixErrorMessage("");
    setOrderId("");
    setCopied(false);
  }, []);

  useEffect(() => {
    if (!open) resetModal();
  }, [open, resetModal]);

  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  useEffect(() => {
    if (status !== "confirmed" || !orderId) return;
    if (purchaseTrackedOrderIdsRef.current.has(orderId)) return;
    purchaseTrackedOrderIdsRef.current.add(orderId);
    metaPixelPurchase(amount / 100, "seguidores_instagram");
  }, [status, orderId, amount]);

  const startPolling = useCallback((oid: string) => {
    if (pollingRef.current) clearInterval(pollingRef.current);

    pollingRef.current = setInterval(async () => {
      try {
        const { data, error } = await supabase.functions.invoke("check-payment", {
          body: { order_id: oid },
        });

        if (error) return;

        const s = data?.status?.toLowerCase();
        if (["paid", "processing", "completed", "placing_smm", "smm_error"].includes(s)) {
          if (pollingRef.current) clearInterval(pollingRef.current);
          setStatus("confirmed");
        }
      } catch {
        /* ignore */
      }
    }, 5000);
  }, []);

  const extractCreatePaymentError = async (
    pdata: {
      success?: boolean;
      error?: string;
      gateway?: string;
      pix?: { qr_code?: string; qr_code_base64?: string };
      order_id?: string;
    } | null,
    fnError: unknown,
  ): Promise<string> => {
    if (pdata?.success === false && typeof pdata.error === "string" && pdata.error) {
      return pdata.error;
    }
    if (fnError instanceof FunctionsHttpError) {
      try {
        const text = await (fnError.context as Response).clone().text();
        const j = JSON.parse(text) as { error?: string; message?: string };
        if (typeof j.error === "string") return j.error;
        if (typeof j.message === "string") return j.message;
      } catch {
        /* ignore */
      }
    }
    if (fnError instanceof FunctionsRelayError) {
      return "O Supabase não alcançou a function create-payment. Faça deploy: npm run deploy:functions";
    }
    if (fnError instanceof FunctionsFetchError) {
      const inner = fnError.context;
      const innerMsg = inner instanceof Error ? inner.message : "";
      const extra =
        innerMsg.includes("Failed to fetch") || innerMsg.includes("NetworkError")
          ? " Desative bloqueador de anúncios; confira internet. Se o projeto é novo, publique as functions: npm run deploy:functions"
          : "";
      return `Não foi possível contactar o servidor de pagamento (create-payment).${extra}`;
    }
    if (fnError instanceof Error) return fnError.message;
    return "Não foi possível gerar o PIX. Tente de novo.";
  };

  const invokeCreatePayment = async (body: Record<string, unknown>) => {
    const amountCents = typeof body.amount === "number" ? body.amount : 0;
    setPaymentMethod("pix");
    setStatus("generating");
    setPixGateway(null);
    setPixErrorMessage("");

    const fail = async (msg: string) => {
      setPixErrorMessage(msg);
      toast.error(msg.length > 180 ? `${msg.slice(0, 180)}…` : msg);
      setStatus("error");
    };

    try {
      const { data: paymentData, error: fnError } = await supabase.functions.invoke("create-payment", {
        body,
      });

      const pdata = paymentData as
        | {
            success?: boolean;
            error?: string;
            gateway?: string;
            pix?: { qr_code?: string; qr_code_base64?: string };
            order_id?: string;
          }
        | null;

      if (pdata?.success === false) {
        await fail(pdata.error || "Erro ao gerar PIX");
        return;
      }

      if (fnError) {
        await fail(await extractCreatePaymentError(pdata, fnError));
        return;
      }

      if (pdata?.pix?.qr_code || pdata?.pix?.qr_code_base64) {
        setPixCode(pdata.pix.qr_code || "");
        setPixQrBase64(pdata.pix.qr_code_base64 || "");
        setPixGateway(pdata.gateway ?? null);
        setOrderId(pdata.order_id || "");
        setStatus("ready");

        if (pdata.order_id) {
          startPolling(pdata.order_id);
          metaPixelInitiateCheckout(amountCents / 100, "seguidores_instagram");
        }
      } else {
        await fail(pdata?.error || "Resposta do servidor sem código PIX.");
      }
    } catch (err) {
      console.error("Payment error:", err);
      const msg = err instanceof Error ? err.message : "Erro ao gerar pagamento.";
      setPixErrorMessage(msg);
      setStatus("error");
      toast.error(msg);
    }
  };

  const createPixPayment = async () => {
    const customer = generateFakeCustomer();
    await invokeCreatePayment({
      username,
      quantity,
      amount,
      is_discounted: isDiscounted,
      customer: {
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        document: customer.document.replace(/\D/g, ""),
      },
    });
  };

  const copyPixCode = () => {
    if (pixCode) {
      navigator.clipboard.writeText(pixCode);
      setCopied(true);
      toast.success("Código Pix copiado!");
      setTimeout(() => setCopied(false), 3000);
    }
  };

  const handleChangeProfile = () => {
    const newUser = prompt("Digite o novo @usuário:");
    if (newUser && newUser.trim()) {
      const cleanUser = newUser.trim().replace("@", "");
      const path = window.location.pathname;
      const eqIndex = path.indexOf("=");
      const prefix = path.substring(1, eqIndex);
      window.location.href = `/${prefix}=${cleanUser}`;
    }
  };

  const formattedPrice = `R$ ${(amount / 100).toFixed(2).replace(".", ",")}`;

  const followersApproxLabel =
    profileFollowers != null && Number.isFinite(profileFollowers) && profileFollowers >= 0
      ? `~${Math.round(profileFollowers).toLocaleString("pt-BR")} seguidores agora (aprox.)`
      : null;

  const showFollowersOnlySuccess = status === "confirmed";

  return (
    <Dialog open={open}>
      <DialogContent
        className="sm:max-w-lg border-border bg-card p-0 gap-0 overflow-hidden [&>button]:hidden max-h-[90vh] overflow-y-auto"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        {/* CHOOSING — seguidores */}
        {paymentMethod === "choosing" && (
          <div className="flex flex-col p-6 gap-5">
            <div className="text-center">
              <div className="flex flex-col items-center gap-1 mb-2">
                <div className="flex items-center justify-center gap-2">
                  {profilePic && (
                    <img src={profilePic} alt={username} className="w-8 h-8 rounded-full object-cover" />
                  )}
                  <span className="text-sm text-foreground font-semibold">@{username}</span>
                </div>
                {followersApproxLabel && (
                  <p className="text-xs text-muted-foreground">{followersApproxLabel}</p>
                )}
              </div>
              <h2 className="text-lg font-bold text-foreground">Comprar {quantity} seguidores brasileiros 🇧🇷</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Valor: <span className="text-primary font-semibold">{formattedPrice}</span>
              </p>
            </div>

            <p className="text-sm font-semibold text-foreground text-center">Pagamento via PIX:</p>

            <button
              onClick={createPixPayment}
              className="flex flex-col items-center gap-3 p-5 rounded-xl border-2 border-border bg-background hover:border-primary transition-colors group w-full"
            >
              <div className="w-14 h-14 rounded-full bg-green-500/10 flex items-center justify-center group-hover:bg-green-500/20 transition-colors">
                <QrCode className="h-7 w-7 text-green-500" />
              </div>
              <div className="text-center">
                <p className="text-sm font-bold text-foreground">Gerar código PIX</p>
                <p className="text-xs text-muted-foreground">Pagamento instantâneo</p>
              </div>
            </button>

            <button onClick={handleChangeProfile} className="text-xs text-primary hover:underline text-center">
              O perfil não é este? Mudar
            </button>
          </div>
        )}

        {/* GENERATING — seguidores */}
        {paymentMethod === "pix" && status === "generating" && (
          <div className="flex flex-col items-center justify-center py-16 gap-5">
            <div className="relative w-20 h-20">
              <div
                className="absolute inset-0 rounded-full gradient-instagram animate-spin"
                style={{
                  mask: "radial-gradient(farthest-side, transparent calc(100% - 3px), black calc(100% - 3px))",
                  WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 3px), black calc(100% - 3px))",
                }}
              />
              {profilePic && (
                <img src={profilePic} alt={username} className="absolute inset-2 w-16 h-16 rounded-full object-cover" />
              )}
            </div>
            <div className="text-center space-y-1">
              <p className="text-base font-semibold text-foreground">Gerando pagamento...</p>
              <p className="text-sm text-muted-foreground">Preparando Pix para @{username}</p>
              {followersApproxLabel && (
                <p className="text-xs text-muted-foreground">{followersApproxLabel}</p>
              )}
            </div>
          </div>
        )}

        {/* READY — seguidores */}
        {paymentMethod === "pix" && status === "ready" && (
          <div className="flex flex-col">
            <div className="px-6 pt-6 pb-4">
              <h2 className="text-lg font-bold text-foreground">Comprar {quantity} seguidores brasileiros 🇧🇷</h2>
              <p className="text-sm text-muted-foreground">
                Valor: <span className="text-primary font-semibold">{formattedPrice}</span>
              </p>
              {pixGateway && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  Provedor do PIX:{" "}
                  <span className="font-medium text-foreground">
                    {pixGateway === "skale" ? "SkalePayments" : "X (ExPay)"}
                  </span>
                </p>
              )}
            </div>

            <div className="px-6 pb-4 flex flex-col items-center gap-1">
              <div className="flex items-center gap-2">
                {profilePic && (
                  <img src={profilePic} alt={username} className="w-6 h-6 rounded-full object-cover" />
                )}
                <span className="text-sm text-foreground">
                  Seguidores para <span className="font-semibold">@{username}</span>
                </span>
              </div>
              {followersApproxLabel && (
                <p className="text-xs text-muted-foreground text-center">{followersApproxLabel}</p>
              )}
              <button onClick={handleChangeProfile} className="text-xs text-primary hover:underline">
                O perfil não é este? Mudar
              </button>
            </div>

            {(pixQrBase64 || pixCode) && (
              <div className="flex justify-center px-6 pb-4">
                <div className="bg-white p-3 rounded-xl inline-block">
                  {pixCode.trim() ? (
                    <PixQRCode
                      value={pixCode}
                      size={192}
                      level="M"
                      bgColor="#ffffff"
                      fgColor="#000000"
                      title="PIX copia e cola"
                    />
                  ) : pixQrBase64 ? (
                    <img
                      src={`data:image/png;base64,${pixQrBase64}`}
                      alt="QR Code Pix"
                      className="w-48 h-48 object-contain"
                    />
                  ) : null}
                </div>
              </div>
            )}

            <div className="px-6 pb-3">
              <p className="text-xs text-muted-foreground text-center mb-2">Copie e pague no app do seu banco:</p>
              <textarea
                readOnly
                value={pixCode}
                className="w-full h-20 bg-muted border border-border rounded-lg p-3 text-xs text-foreground resize-none text-center focus:outline-none"
              />
            </div>

            <div className="px-6 pb-4">
              <button
                onClick={copyPixCode}
                className="w-full gradient-instagram text-primary-foreground font-bold py-3 rounded-lg flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
              >
                {copied ? (
                  <>
                    <Check className="h-5 w-5" /> Código copiado!
                  </>
                ) : (
                  <>
                    <Copy className="h-5 w-5" /> Copiar código PIX
                  </>
                )}
              </button>
            </div>

            <div className="px-6 pb-4">
              <p className="text-xs font-bold text-muted-foreground text-center mb-3 tracking-wider">COMO PAGAR</p>
              <div className="space-y-2.5">
                <div className="flex items-start gap-3">
                  <span className="text-sm">🏦</span>
                  <p className="text-xs text-muted-foreground">Abra o app do seu banco ou carteira digital</p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-sm">📲</span>
                  <p className="text-xs text-muted-foreground">Toque em &quot;Pagar com PIX&quot; e escolha &quot;Copia e Cola&quot;</p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-sm">✅</span>
                  <p className="text-xs text-muted-foreground">Cole o código copiado e confirme o pagamento</p>
                </div>
              </div>
            </div>

            <div className="px-6 pb-6 flex items-center justify-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Aguardando pagamento...</p>
            </div>
          </div>
        )}

        {/* Sucesso seguidores */}
        {showFollowersOnlySuccess && (
          <div className="flex flex-col items-center justify-center py-12 px-6 gap-5">
            <div className="relative">
              <div className="w-24 h-24 rounded-full bg-emerald-500/20 flex items-center justify-center animate-in zoom-in duration-500">
                <CheckCircle className="h-14 w-14 text-emerald-500" />
              </div>
              <div className="absolute -top-2 -right-2">
                <PartyPopper className="h-8 w-8 text-accent animate-in spin-in duration-700" />
              </div>
            </div>

            <div className="text-center space-y-2">
              <h2 className="text-2xl font-black text-foreground">Pagamento confirmado!</h2>
              <p className="text-sm text-muted-foreground">
                Seus <span className="text-primary font-bold">{quantity} seguidores</span> estão sendo adicionados ao
                perfil
              </p>
            </div>

            <div className="flex items-center gap-3 bg-muted rounded-xl px-5 py-3">
              {profilePic && (
                <img src={profilePic} alt={username} className="w-10 h-10 rounded-full object-cover" />
              )}
              <div>
                <p className="text-sm font-semibold text-foreground">@{username}</p>
                {followersApproxLabel && (
                  <p className="text-[11px] text-muted-foreground">{followersApproxLabel}</p>
                )}
                <p className="text-xs text-emerald-500 font-medium">+{quantity} seguidores em processamento</p>
              </div>
            </div>

            <div className="w-full space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center">
                  <Check className="h-3 w-3 text-primary-foreground" />
                </div>
                <p className="text-xs text-foreground">Pagamento recebido</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center">
                  <Check className="h-3 w-3 text-primary-foreground" />
                </div>
                <p className="text-xs text-foreground">Pedido confirmado</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full gradient-instagram flex items-center justify-center">
                  <Loader2 className="h-3 w-3 text-primary-foreground animate-spin" />
                </div>
                <p className="text-xs text-foreground">Adicionando seguidores...</p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground text-center mt-2">
              Os seguidores serão adicionados em até <span className="font-semibold text-foreground">30 minutos</span>.
              <br />
              Você pode fechar esta página.
            </p>
          </div>
        )}

        {/* ERROR — seguidores */}
        {paymentMethod === "pix" && status === "error" && (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <div className="w-14 h-14 rounded-full bg-destructive/20 flex items-center justify-center">
              <X className="h-7 w-7 text-destructive" />
            </div>
            <p className="text-base font-bold text-foreground">Erro ao gerar pagamento</p>
            {pixErrorMessage ? (
              <p className="text-xs text-destructive/90 text-center max-w-sm px-2 break-words leading-relaxed">
                {pixErrorMessage}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground text-center">Recarregue a página para tentar novamente</p>
            )}
            <button
              onClick={() => window.location.reload()}
              className="gradient-instagram text-primary-foreground font-semibold px-6 py-2.5 rounded-lg"
            >
              Recarregar
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
