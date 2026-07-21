import type { Metadata } from "next";
import { LegalPage, type LegalContent } from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "Kebijakan Privasi / Privacy Policy — Kelolako",
  robots: "noindex",
};

const content: LegalContent = {
  indonesian: {
    pageTitle: "Kebijakan Privasi",
    effectiveDate: "Terakhir diperbarui: 3 Juli 2026",
    intro: "Kebijakan Privasi ini menjelaskan bagaimana Kelolako (\"kami\") mengumpulkan, menggunakan, menyimpan, dan melindungi informasi Anda saat menggunakan platform Kelolako (\"Layanan\"). Pengendali data untuk Layanan ini adalah Usaha Perorangan atas nama Muhammad Septian Hadiguna, dengan Nomor Induk Berusaha (NIB) 0307260041044, berkedudukan di Jakarta Barat, DKI Jakarta.",
    sections: [
      {
        heading: "1. Informasi yang Kami Kumpulkan",
        blocks: [
          { type: "h3", text: "1.1 Informasi Akun" },
          { type: "ul", items: [
            "Alamat email, nama lengkap, dan foto profil (jika mendaftar melalui Google);",
            "Alamat email, nama lengkap, dan kata sandi terenkripsi (jika mendaftar melalui email).",
          ]},
          { type: "h3", text: "1.2 Konten Pengguna" },
          { type: "ul", items: [
            "Video dan foto yang Anda unggah;",
            "Konten (video/foto/caption) yang dihasilkan melalui fitur AI kami.",
          ]},
          { type: "h3", text: "1.3 Data Koneksi Platform Pihak Ketiga" },
          { type: "ul", items: [
            "Token otorisasi OAuth (access token, refresh token) untuk platform yang Anda hubungkan, seperti YouTube, dan di masa depan TikTok/Instagram — digunakan semata-mata untuk mempublikasikan konten atas nama Anda sesuai instruksi Anda.",
          ]},
          { type: "h3", text: "1.4 Data Transaksi dan Kredit" },
          { type: "ul", items: [
            "Riwayat pembelian dan penggunaan Kredit virtual;",
            "Data transaksi pembayaran diproses oleh mitra gerbang pembayaran kami (DOKU) — Kelolako tidak menyimpan detail kartu pembayaran Anda.",
          ]},
          { type: "h3", text: "1.5 Data Teknis" },
          { type: "ul", items: [
            "Alamat IP, jenis perangkat/browser, dan cookie sesi untuk keperluan autentikasi.",
          ]},
        ],
      },
      {
        heading: "2. Bagaimana Kami Menggunakan Informasi Anda",
        blocks: [
          { type: "ul", items: [
            "Menyediakan dan mengoperasikan Layanan, termasuk pembuatan konten AI dan penjadwalan publikasi;",
            "Memproses konten Anda melalui penyedia AI pihak ketiga (Replicate, termasuk Google Gemini dan OpenAI Whisper) untuk menghasilkan caption dan mentranskripsi audio;",
            "Memproses video melalui penyedia pemrosesan video pihak ketiga (Rendi) untuk ekstraksi audio dan operasi video lainnya;",
            "Mempublikasikan konten Anda ke Platform Terhubung sesuai instruksi Anda;",
            "Memproses pembayaran Kredit melalui DOKU;",
            "Berkomunikasi dengan Anda terkait akun dan pembaruan Layanan;",
            "Meningkatkan dan mengembangkan fitur Layanan.",
          ]},
        ],
      },
      {
        heading: "3. Pihak Ketiga yang Menerima Data Anda",
        blocks: [
          { type: "p", text: "Untuk mengoperasikan Layanan, kami membagikan data yang relevan (sebatas yang diperlukan) kepada penyedia layanan berikut:" },
          { type: "ul", items: [
            "Google — untuk otentikasi (Google Sign-In) dan publikasi konten via YouTube Data API;",
            "Supabase — penyedia basis data, penyimpanan file, dan sistem autentikasi kami;",
            "Replicate — penyedia model AI untuk pembuatan video, foto, dan caption (termasuk model Google Gemini dan OpenAI Whisper);",
            "Rendi — penyedia pemrosesan video (ekstraksi audio, dll.);",
            "DOKU — penyedia gerbang pembayaran untuk pembelian Kredit;",
            "Vercel — penyedia hosting infrastruktur aplikasi kami;",
            "TikTok dan Instagram/Meta — [PLACEHOLDER: akan ditambahkan setelah integrasi API disetujui].",
          ]},
          { type: "p", text: "Setiap penyedia layanan di atas memiliki kebijakan privasi masing-masing yang independen dari kebijakan ini." },
        ],
      },
      {
        heading: "4. Penyimpanan dan Keamanan Data",
        blocks: [
          { type: "p", text: "Data Anda disimpan menggunakan infrastruktur basis data dan penyimpanan Supabase, dengan aplikasi di-hosting melalui Vercel. Kami menerapkan langkah-langkah keamanan yang wajar, termasuk enkripsi data dalam transit (HTTPS/TLS), namun tidak ada sistem yang sepenuhnya kebal terhadap risiko keamanan." },
          { type: "p", text: "Server penyimpanan data kami mungkin berlokasi di luar wilayah Indonesia, tergantung region infrastruktur Supabase dan Vercel yang digunakan. Dengan menggunakan Layanan, Anda menyetujui kemungkinan transfer data lintas negara ini." },
        ],
      },
      {
        heading: "5. Retensi Data",
        blocks: [
          { type: "p", text: "Kami menyimpan data Anda selama akun Anda aktif. Setelah publikasi konten berhasil ke Platform Terhubung, file video sumber dapat dihapus secara otomatis dari penyimpanan kami untuk efisiensi (metadata publikasi tetap disimpan). Anda dapat meminta penghapusan seluruh data akun Anda dengan menghubungi kami (lihat Bagian 8)." },
        ],
      },
      {
        heading: "6. Hak Anda",
        blocks: [
          { type: "p", text: "Anda memiliki hak untuk:" },
          { type: "ul", items: [
            "Mengakses dan meminta salinan data pribadi Anda;",
            "Meminta koreksi data yang tidak akurat;",
            "Meminta penghapusan akun dan data Anda;",
            "Memutuskan koneksi (\"Disconnect\") Platform Terhubung kapan saja melalui pengaturan akun Anda, yang akan menghapus token otorisasi terkait dari sistem kami.",
          ]},
        ],
      },
      {
        heading: "7. Privasi Anak",
        blocks: [
          { type: "p", text: "Layanan ini tidak ditujukan untuk pengguna berusia di bawah 18 tahun. Kami tidak dengan sengaja mengumpulkan informasi pribadi dari anak di bawah usia tersebut. Jika kami mengetahui hal ini terjadi, kami akan menghapus informasi tersebut secepatnya." },
        ],
      },
      {
        heading: "8. Perubahan Kebijakan dan Kontak",
        blocks: [
          { type: "p", text: "Kami dapat memperbarui Kebijakan Privasi ini dari waktu ke waktu. Perubahan material akan diberitahukan melalui email atau pemberitahuan dalam aplikasi." },
          { type: "p", text: "Untuk pertanyaan, permintaan akses data, atau permintaan penghapusan data, silakan hubungi kami di: krakatoateams@gmail.com" },
        ],
      },
    ],
  },
  english: {
    pageTitle: "Privacy Policy",
    effectiveDate: "Last updated: July 3, 2026",
    intro: "This Privacy Policy explains how Kelolako (\"we\") collects, uses, stores, and protects your information when you use the Kelolako platform (\"Service\"). The data controller for this Service is an Individual Business (Usaha Perorangan) registered under the name Muhammad Septian Hadiguna, with Business Identification Number (NIB) 0307260041044, domiciled in West Jakarta, DKI Jakarta.",
    sections: [
      {
        heading: "1. Information We Collect",
        blocks: [
          { type: "h3", text: "1.1 Account Information" },
          { type: "ul", items: [
            "Email address, full name, and profile photo (if registering via Google);",
            "Email address, full name, and encrypted password (if registering via email).",
          ]},
          { type: "h3", text: "1.2 User Content" },
          { type: "ul", items: [
            "Videos and photos you upload;",
            "Content (video/photo/caption) generated through our AI features.",
          ]},
          { type: "h3", text: "1.3 Third-Party Platform Connection Data" },
          { type: "ul", items: [
            "OAuth authorization tokens (access token, refresh token) for platforms you connect, such as YouTube, and in the future TikTok/Instagram — used solely to publish content on your behalf according to your instructions.",
          ]},
          { type: "h3", text: "1.4 Transaction and Credit Data" },
          { type: "ul", items: [
            "Purchase and usage history of virtual Credits;",
            "Payment transaction data is processed by our payment gateway partner (DOKU) — Kelolako does not store your payment card details.",
          ]},
          { type: "h3", text: "1.5 Technical Data" },
          { type: "ul", items: [
            "IP address, device/browser type, and session cookies for authentication purposes.",
          ]},
        ],
      },
      {
        heading: "2. How We Use Your Information",
        blocks: [
          { type: "ul", items: [
            "To provide and operate the Service, including AI content generation and publishing scheduling;",
            "To process your content through third-party AI providers (Replicate, including Google Gemini and OpenAI Whisper) to generate captions and transcribe audio;",
            "To process video through our third-party video processing provider (Rendi) for audio extraction and other video operations;",
            "To publish your content to Connected Platforms according to your instructions;",
            "To process Credit payments through DOKU;",
            "To communicate with you regarding your account and Service updates;",
            "To improve and develop Service features.",
          ]},
        ],
      },
      {
        heading: "3. Third Parties That Receive Your Data",
        blocks: [
          { type: "p", text: "To operate the Service, we share relevant data (limited to what is necessary) with the following service providers:" },
          { type: "ul", items: [
            "Google — for authentication (Google Sign-In) and content publishing via the YouTube Data API;",
            "Supabase — our database, file storage, and authentication system provider;",
            "Replicate — AI model provider for video, photo, and caption generation (including Google Gemini and OpenAI Whisper models);",
            "Rendi — video processing provider (audio extraction, etc.);",
            "DOKU — payment gateway provider for Credit purchases;",
            "Vercel — our application hosting infrastructure provider;",
            "TikTok and Instagram/Meta — [PLACEHOLDER: to be added once API integration is approved].",
          ]},
          { type: "p", text: "Each service provider listed above has its own privacy policy independent of this one." },
        ],
      },
      {
        heading: "4. Data Storage and Security",
        blocks: [
          { type: "p", text: "Your data is stored using Supabase's database and storage infrastructure, with the application hosted via Vercel. We implement reasonable security measures, including encryption of data in transit (HTTPS/TLS), however no system is completely immune to security risks." },
          { type: "p", text: "Our data storage servers may be located outside of Indonesia, depending on the infrastructure region of Supabase and Vercel used. By using the Service, you consent to this possibility of cross-border data transfer." },
        ],
      },
      {
        heading: "5. Data Retention",
        blocks: [
          { type: "p", text: "We retain your data for as long as your account remains active. After successful content publication to a Connected Platform, source video files may be automatically deleted from our storage for efficiency (publication metadata is retained). You may request deletion of all your account data by contacting us (see Section 8)." },
        ],
      },
      {
        heading: "6. Your Rights",
        blocks: [
          { type: "p", text: "You have the right to:" },
          { type: "ul", items: [
            "Access and request a copy of your personal data;",
            "Request correction of inaccurate data;",
            "Request deletion of your account and data;",
            "Disconnect Connected Platforms at any time via your account settings, which will remove the associated authorization tokens from our system.",
          ]},
        ],
      },
      {
        heading: "7. Children's Privacy",
        blocks: [
          { type: "p", text: "This Service is not intended for users under the age of 18. We do not knowingly collect personal information from minors below that age. If we become aware this has occurred, we will delete the information as soon as possible." },
        ],
      },
      {
        heading: "8. Changes to This Policy and Contact",
        blocks: [
          { type: "p", text: "We may update this Privacy Policy from time to time. Material changes will be notified via email or in-app notice." },
          { type: "p", text: "For questions, data access requests, or data deletion requests, please contact us at: krakatoateams@gmail.com" },
        ],
      },
    ],
  },
};

export default function PrivacyPage() {
  return <LegalPage content={content} />;
}
