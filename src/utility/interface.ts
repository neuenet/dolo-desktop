


/// export

export interface ConfigFile {
  ksk: {
    private: string;
    public: string;
  },
  main: {
    domain: string;
    host: string;
  },
  zsk: {
    private: string;
    public: string;
  }
}

export interface LooseObject {
  [key: string]: any
}
