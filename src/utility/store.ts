


/// import

import { writable } from "svelte/store";



/// export

export const entry = writable({ domain: "", nameserver1: "" });
export const readyForStep2 = writable(false);
