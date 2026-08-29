export type SalespersonVoiceChoice = {
  id: string;
  name: string;
  category: string;
  description: string;
  previewUrl: string;
  accent: string;
  age: string;
  gender: string;
  useCase: string;
};

export type SalespersonVoiceLibraryResponse = {
  voices: SalespersonVoiceChoice[];
};
