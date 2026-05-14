import "dotenv/config";
import { Account, RpcProvider, CallData, uint256, cairo } from "starknet";

// Env vars override defaults — set these in the Render/Vercel dashboard.
const RPC_URL =
  process.env.STARKNET_RPC_URL ||
  "https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_10/_zuaFihvvIkJ2dwMdRZ0_";
const AGENT_ADDRESS =
  process.env.AGENT_ADDRESS ||
  "0x1f8975c5a1c6d2764bd30dddf4d6ab80c59e8287e5f796a5ba2490dcbf2dab6";
const AGENT_PRIVATE_KEY =
  process.env.AGENT_PRIVATE_KEY ||
  "0xbeeeb0e3f13b59cc5360498201dfd3933a6863f4618b3cad073f85b1f1288";

export const POOL_ADDRESS =
  process.env.POOL_ADDRESS ||
  "0x06ef0863a1353770bf483bf57e8623b262ccccdfbf183cdd086d45bbcdf85fac";
export const GOVERNOR_ADDRESS =
  process.env.GOVERNOR_ADDRESS ||
  "0x00726210f3763cb4cfffb6c6a41526a85afe47a87a8a38b2000cb96e6e569c9a";

export const provider = new RpcProvider({ nodeUrl: RPC_URL });

let _agent: Account | null = null;
function getAgent(): Account {
  if (!_agent) {
    _agent = new Account({
      provider,
      address: AGENT_ADDRESS,
      signer: AGENT_PRIVATE_KEY,
    } as any);
  }
  return _agent;
}

export function ratioToWad(ratio: number): bigint {
  return BigInt(Math.round(ratio * 1e18));
}

export function wadToRatio(wad: bigint): number {
  return Number(wad) / 1e18;
}

export async function readPoolState(): Promise<{
  ltv: number;
  liqThreshold: number;
  collateralPrice: number;
}> {
  const [ltvRes, ltRes, priceRes] = await Promise.all([
    provider.callContract({ contractAddress: POOL_ADDRESS, entrypoint: "get_ltv" }),
    provider.callContract({ contractAddress: POOL_ADDRESS, entrypoint: "get_liquidation_threshold" }),
    provider.callContract({ contractAddress: POOL_ADDRESS, entrypoint: "get_collateral_price" }),
  ]);

  // Each returns u256 = [low, high]
  const ltv = uint256.uint256ToBN({ low: ltvRes[0], high: ltvRes[1] });
  const lt = uint256.uint256ToBN({ low: ltRes[0], high: ltRes[1] });
  const price = uint256.uint256ToBN({ low: priceRes[0], high: priceRes[1] });

  return {
    ltv: wadToRatio(ltv),
    liqThreshold: wadToRatio(lt),
    collateralPrice: Number(price) / 1e18,
  };
}

export async function proposeParameters(
  newLtv: number,
  newLiqThreshold: number,
  isEmergency: boolean,
): Promise<{ txHash: string }> {
  const ltvWad = ratioToWad(newLtv);
  const ltWad = ratioToWad(newLiqThreshold);

  const tx = await getAgent().execute([
    {
      contractAddress: GOVERNOR_ADDRESS,
      entrypoint: "propose_parameters",
      calldata: CallData.compile({
        new_ltv: cairo.uint256(ltvWad),
        new_liq_threshold: cairo.uint256(ltWad),
        is_emergency: isEmergency,
      }),
    },
  ]);

  return { txHash: tx.transaction_hash };
}

export async function waitForTx(txHash: string): Promise<void> {
  await provider.waitForTransaction(txHash);
}

export function voyagerUrl(txHash: string): string {
  return `https://sepolia.voyager.online/tx/${txHash}`;
}

export function voyagerContractUrl(addr: string): string {
  return `https://sepolia.voyager.online/contract/${addr}`;
}
