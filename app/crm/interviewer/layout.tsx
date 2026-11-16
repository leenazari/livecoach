import { Inter, Roboto_Slab } from "next/font/google";

import styles from "@/components/interviewer/interviewa.module.css";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const slab = Roboto_Slab({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-slab" });

export default function InterviewaLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${inter.className} ${slab.variable} ${styles.shell}`}>{children}</div>;
}
