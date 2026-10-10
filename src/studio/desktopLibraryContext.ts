import { createContext } from "react";
import type { DesktopLibrary } from "../desktop/types";
export const DesktopLibraryContext = createContext<DesktopLibrary | undefined>(undefined);
