import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";

type Bridge = {
  directConfigure(owner: string, config: string): Promise<string>;
  directStatus(owner: string): Promise<string>;
  directAuthenticate(owner: string, kind: string, value: string): Promise<string>;
  configure(
    owner: string,
    token: string,
    base: string,
    wifi: boolean,
    charging: boolean,
  ): Promise<void>;
  detach(owner: string): Promise<void>;
  enqueue(owner: string, tasks: string): Promise<void>;
  snapshot(owner: string): Promise<string>;
  action(owner: string, id: string, action: string): Promise<void>;
  clearFinished(owner: string): Promise<void>;
  sha256(uri: string): Promise<string>;
  consumeShares(): Promise<string>;
  scanDocument(): Promise<string | null>;
  configureBackup(
    owner: string,
    album: string,
    folder: string | null,
    enabled: boolean,
  ): Promise<void>;
  backupStatus(owner: string): Promise<string>;
  addListener(event: string, listener: () => void): { remove: () => void };
};
export const nativeTransfer: Bridge | null =
  Platform.OS === "android"
    ? requireOptionalNativeModule<Bridge>("AxyaTransfer")
    : null;
