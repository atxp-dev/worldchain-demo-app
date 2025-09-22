// import { farcasterMiniApp as miniAppConnector } from "@farcaster/miniapp-wagmi-connector";
import { worldchain } from "viem/chains";
import { cookieStorage, createConfig, createStorage, http } from "wagmi";
import { injected } from "wagmi/connectors";
// import { env } from "@/lib/env";

// Create wagmi config with all required chains
export const wagmiConfig = createConfig({
  ssr: true,
  storage: createStorage({ storage: cookieStorage }),
  chains: [worldchain],
  transports: {
    [worldchain.id]: http(
      `https://worldchain-mainnet.g.alchemy.com/public`,
    ),
  },
  connectors: [
    injected(),
    // baseAccount({
    //   appName: "Imagine",
    //   appLogoUrl: `${env.NEXT_PUBLIC_URL}/images/icon.png`,
    // }),
    // miniAppConnector(),
  ],
});
