import type { Metadata } from "next";
import { LegalPage, type LegalContent } from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "Syarat dan Ketentuan / Terms of Service — Krakatoa",
  robots: "noindex",
};

const content: LegalContent = {
  indonesian: {
    pageTitle: "Syarat dan Ketentuan Layanan",
    effectiveDate: "Terakhir diperbarui: 3 Juli 2026",
    intro: "Dengan mengakses atau menggunakan Kelolako (\"Layanan\", \"kami\", \"Kelolako\"), Anda menyetujui untuk terikat oleh Syarat dan Ketentuan (\"Syarat\") ini. Jika Anda tidak menyetujui Syarat ini, mohon untuk tidak menggunakan Layanan kami. Layanan ini dioperasikan oleh Usaha Perorangan atas nama Muhammad Septian Hadiguna, dengan Nomor Induk Berusaha (NIB) 0307260041044, berkedudukan di Jakarta Barat, DKI Jakarta, selanjutnya disebut \"Kelolako\".",
    sections: [
      {
        heading: "1. Deskripsi Layanan",
        blocks: [
          { type: "p", text: "Kelolako adalah platform Software-as-a-Service (SaaS) berbasis AI yang membantu kreator konten dalam:" },
          { type: "ul", items: [
            "Menghasilkan konten video dan foto menggunakan model kecerdasan buatan (AI);",
            "Menghasilkan caption/keterangan konten secara otomatis;",
            "Menjadwalkan dan mempublikasikan konten secara otomatis ke platform media sosial pihak ketiga, termasuk namun tidak terbatas pada YouTube, TikTok, dan Instagram (\"Platform Terhubung\").",
          ]},
          { type: "p", text: "Kelolako dapat menambah, mengubah, atau menghentikan fitur tertentu dari Layanan kapan saja dengan atau tanpa pemberitahuan sebelumnya." },
        ],
      },
      {
        heading: "2. Kelayakan Pengguna",
        blocks: [
          { type: "p", text: "Anda harus berusia minimal 18 (delapan belas) tahun untuk menggunakan Layanan ini, mengingat Layanan melibatkan transaksi pembayaran dan publikasi konten ke platform pihak ketiga. Dengan menggunakan Layanan, Anda menyatakan dan menjamin bahwa Anda memenuhi persyaratan usia ini." },
        ],
      },
      {
        heading: "3. Pendaftaran Akun",
        blocks: [
          { type: "p", text: "Anda dapat mendaftar menggunakan akun Google (OAuth) atau menggunakan alamat email dan kata sandi. Anda bertanggung jawab penuh untuk:" },
          { type: "ul", items: [
            "Menjaga kerahasiaan kredensial akun Anda;",
            "Semua aktivitas yang terjadi di bawah akun Anda;",
            "Memberikan informasi pendaftaran yang akurat dan terkini.",
          ]},
          { type: "p", text: "Kelolako berhak menangguhkan atau menghentikan akun yang terindikasi memberikan informasi palsu atau menyalahgunakan Layanan." },
        ],
      },
      {
        heading: "4. Konten Pengguna",
        blocks: [
          { type: "h3", text: "4.1 Kepemilikan" },
          { type: "p", text: "Anda tetap memiliki seluruh hak atas konten (video, foto, teks) yang Anda unggah ke Layanan (\"Konten Pengguna\")." },
          { type: "h3", text: "4.2 Lisensi kepada Kelolako" },
          { type: "p", text: "Dengan mengunggah Konten Pengguna, Anda memberikan Kelolako lisensi terbatas, non-eksklusif, dan dapat dicabut untuk menyimpan, memproses, mengubah (melalui fitur AI), dan mempublikasikan Konten Pengguna tersebut sesuai instruksi Anda ke Platform Terhubung yang Anda pilih." },
          { type: "h3", text: "4.3 Tanggung Jawab Konten" },
          { type: "p", text: "Anda bertanggung jawab penuh atas legalitas, keakuratan, dan kesesuaian Konten Pengguna Anda, termasuk kepatuhan terhadap hak cipta pihak ketiga dan kebijakan Platform Terhubung." },
        ],
      },
      {
        heading: "5. Konten Hasil AI",
        blocks: [
          { type: "p", text: "Layanan menggunakan model kecerdasan buatan pihak ketiga (termasuk namun tidak terbatas pada model dari Replicate, Google Gemini, dan OpenAI Whisper) untuk menghasilkan atau memproses konten. Anda memahami dan menyetujui bahwa:" },
          { type: "ul", items: [
            "Konten yang dihasilkan AI dapat mengandung ketidakakuratan, kesalahan, atau hal yang tidak sesuai harapan;",
            "Anda bertanggung jawab untuk meninjau seluruh konten hasil AI sebelum mempublikasikannya;",
            "Kelolako tidak menjamin keakuratan, orisinalitas, atau kesesuaian konten hasil AI untuk tujuan tertentu.",
          ]},
        ],
      },
      {
        heading: "6. Koneksi ke Platform Pihak Ketiga",
        blocks: [
          { type: "p", text: "Fitur penjadwalan dan publikasi otomatis Kelolako memerlukan Anda untuk menghubungkan (\"Connect\") akun Platform Terhubung Anda (misalnya YouTube) melalui proses otorisasi OAuth. Dengan menghubungkan akun tersebut, Anda memberikan izin kepada Kelolako untuk mempublikasikan konten atas nama Anda sesuai instruksi yang Anda berikan melalui Layanan." },
          { type: "p", text: "Anda dapat memutuskan koneksi (\"Disconnect\") kapan saja melalui halaman pengaturan akun Anda. Kelolako tidak bertanggung jawab atas perubahan kebijakan, gangguan, atau penghentian layanan dari pihak Platform Terhubung yang berada di luar kendali kami." },
        ],
      },
      {
        heading: "7. Kredit dan Pembayaran",
        blocks: [
          { type: "p", text: "Sebagian fitur Layanan menggunakan sistem kredit virtual (\"Kredit\") yang dapat dibeli menggunakan uang sungguhan melalui penyedia gerbang pembayaran pihak ketiga (DOKU). Dengan melakukan pembelian, Anda menyetujui:" },
          { type: "ul", items: [
            "Harga Kredit dapat berubah sewaktu-waktu dengan pemberitahuan yang wajar;",
            "Kredit yang telah dibeli [PLACEHOLDER: kebijakan pengembalian dana — perlu diputuskan oleh tim];",
            "Kelolako tidak menyimpan detail kartu pembayaran Anda — seluruh pemrosesan pembayaran ditangani oleh DOKU sesuai kebijakan privasi mereka sendiri.",
          ]},
        ],
      },
      {
        heading: "8. Penggunaan yang Dilarang",
        blocks: [
          { type: "p", text: "Anda dilarang menggunakan Layanan untuk:" },
          { type: "ul", items: [
            "Mengunggah atau mempublikasikan konten yang melanggar hukum, hak cipta, atau hak pihak ketiga lainnya;",
            "Menyebarkan konten kebencian, kekerasan, pelecehan, atau konten dewasa yang melanggar kebijakan Platform Terhubung;",
            "Melakukan spam atau aktivitas yang menyalahgunakan sistem penjadwalan otomatis;",
            "Mencoba merekayasa balik (reverse-engineer), meretas, atau mengganggu keamanan Layanan;",
            "Melanggar Syarat Layanan dari Platform Terhubung manapun (misalnya Ketentuan Layanan YouTube).",
          ]},
        ],
      },
      {
        heading: "9. Hak Kekayaan Intelektual Kelolako",
        blocks: [
          { type: "p", text: "Seluruh hak atas nama, logo, antarmuka, dan perangkat lunak Kelolako adalah milik Kelolako dan dilindungi hukum kekayaan intelektual yang berlaku. Anda tidak diperbolehkan menyalin, memodifikasi, atau mendistribusikan ulang perangkat lunak Kelolako tanpa izin tertulis." },
        ],
      },
      {
        heading: "10. Penangguhan dan Penghentian",
        blocks: [
          { type: "p", text: "Kelolako berhak menangguhkan atau menghentikan akses Anda ke Layanan sewaktu-waktu jika Anda melanggar Syarat ini. Anda dapat menghentikan penggunaan Layanan dan meminta penghapusan akun Anda kapan saja dengan menghubungi kami melalui kontak di Bagian 13." },
        ],
      },
      {
        heading: "11. Penafian dan Batasan Tanggung Jawab",
        blocks: [
          { type: "p", text: "LAYANAN DISEDIAKAN \"SEBAGAIMANA ADANYA\" TANPA JAMINAN APAPUN, BAIK TERSURAT MAUPUN TERSIRAT. SEJAUH DIIZINKAN OLEH HUKUM YANG BERLAKU, KELOLAKO TIDAK BERTANGGUNG JAWAB ATAS KERUGIAN TIDAK LANGSUNG, INSIDENTIL, ATAU KONSEKUENSIAL YANG TIMBUL DARI PENGGUNAAN LAYANAN, TERMASUK NAMUN TIDAK TERBATAS PADA KEHILANGAN KONTEN, KEHILANGAN PENDAPATAN, ATAU GANGGUAN PADA PLATFORM TERHUBUNG." },
        ],
      },
      {
        heading: "12. Ganti Rugi dan Perubahan Syarat",
        blocks: [
          { type: "p", text: "Anda setuju untuk membebaskan dan mengganti rugi Kelolako dari segala klaim, kerugian, atau tuntutan pihak ketiga yang timbul akibat penggunaan Layanan atau pelanggaran Anda terhadap Syarat ini." },
          { type: "p", text: "Kelolako dapat memperbarui Syarat ini dari waktu ke waktu. Perubahan material akan diberitahukan melalui email atau pemberitahuan dalam aplikasi. Penggunaan Layanan setelah perubahan berlaku dianggap sebagai persetujuan Anda terhadap Syarat yang telah diperbarui." },
        ],
      },
      {
        heading: "13. Hukum yang Berlaku dan Kontak",
        blocks: [
          { type: "p", text: "Syarat ini diatur oleh dan ditafsirkan sesuai dengan hukum Negara Republik Indonesia, dengan domisili hukum di Jakarta Barat, DKI Jakarta." },
          { type: "p", text: "Jika Anda memiliki pertanyaan mengenai Syarat ini, silakan hubungi kami di: krakatoateams@gmail.com" },
        ],
      },
    ],
  },
  english: {
    pageTitle: "Terms of Service",
    effectiveDate: "Last updated: July 3, 2026",
    intro: "By accessing or using Kelolako (\"Service\", \"we\", \"Kelolako\"), you agree to be bound by these Terms of Service (\"Terms\"). If you do not agree to these Terms, please do not use our Service. The Service is operated by an Individual Business (Usaha Perorangan) registered under the name Muhammad Septian Hadiguna, with Business Identification Number (NIB) 0307260041044, domiciled in West Jakarta, DKI Jakarta, hereinafter referred to as \"Kelolako\".",
    sections: [
      {
        heading: "1. Description of Service",
        blocks: [
          { type: "p", text: "Kelolako is an AI-powered Software-as-a-Service (SaaS) platform that helps content creators to:" },
          { type: "ul", items: [
            "Generate video and photo content using artificial intelligence (AI) models;",
            "Automatically generate captions/descriptions for content;",
            "Schedule and automatically publish content to third-party social media platforms, including but not limited to YouTube, TikTok, and Instagram (\"Connected Platforms\").",
          ]},
          { type: "p", text: "Kelolako may add, modify, or discontinue certain features of the Service at any time, with or without prior notice." },
        ],
      },
      {
        heading: "2. User Eligibility",
        blocks: [
          { type: "p", text: "You must be at least 18 years old to use this Service, given that the Service involves payment transactions and publishing content to third-party platforms. By using the Service, you represent and warrant that you meet this age requirement." },
        ],
      },
      {
        heading: "3. Account Registration",
        blocks: [
          { type: "p", text: "You may register using a Google account (OAuth) or using an email address and password. You are solely responsible for:" },
          { type: "ul", items: [
            "Maintaining the confidentiality of your account credentials;",
            "All activities that occur under your account;",
            "Providing accurate and current registration information.",
          ]},
          { type: "p", text: "Kelolako reserves the right to suspend or terminate accounts found to provide false information or misuse the Service." },
        ],
      },
      {
        heading: "4. User Content",
        blocks: [
          { type: "h3", text: "4.1 Ownership" },
          { type: "p", text: "You retain all rights to the content (video, photo, text) you upload to the Service (\"User Content\")." },
          { type: "h3", text: "4.2 License to Kelolako" },
          { type: "p", text: "By uploading User Content, you grant Kelolako a limited, non-exclusive, revocable license to store, process, modify (through AI features), and publish such User Content according to your instructions to your selected Connected Platforms." },
          { type: "h3", text: "4.3 Content Responsibility" },
          { type: "p", text: "You are solely responsible for the legality, accuracy, and appropriateness of your User Content, including compliance with third-party copyrights and Connected Platform policies." },
        ],
      },
      {
        heading: "5. AI-Generated Content",
        blocks: [
          { type: "p", text: "The Service uses third-party artificial intelligence models (including but not limited to models from Replicate, Google Gemini, and OpenAI Whisper) to generate or process content. You understand and agree that:" },
          { type: "ul", items: [
            "AI-generated content may contain inaccuracies, errors, or unexpected results;",
            "You are responsible for reviewing all AI-generated content before publishing it;",
            "Kelolako does not warrant the accuracy, originality, or fitness for a particular purpose of AI-generated content.",
          ]},
        ],
      },
      {
        heading: "6. Connections to Third-Party Platforms",
        blocks: [
          { type: "p", text: "Kelolako's scheduling and auto-publishing features require you to connect your Connected Platform accounts (e.g., YouTube) through an OAuth authorization process. By connecting such accounts, you authorize Kelolako to publish content on your behalf according to the instructions you provide through the Service." },
          { type: "p", text: "You may disconnect at any time via your account settings page. Kelolako is not responsible for policy changes, disruptions, or discontinuation of service by Connected Platforms that are outside our control." },
        ],
      },
      {
        heading: "7. Credits and Payment",
        blocks: [
          { type: "p", text: "Certain Service features use a virtual credit system (\"Credits\") that can be purchased with real money through a third-party payment gateway provider (DOKU). By making a purchase, you agree that:" },
          { type: "ul", items: [
            "Credit pricing may change from time to time with reasonable notice;",
            "Purchased Credits [PLACEHOLDER: refund policy — to be decided by the team];",
            "Kelolako does not store your payment card details — all payment processing is handled by DOKU under its own privacy policy.",
          ]},
        ],
      },
      {
        heading: "8. Prohibited Uses",
        blocks: [
          { type: "p", text: "You may not use the Service to:" },
          { type: "ul", items: [
            "Upload or publish content that violates the law, copyright, or other third-party rights;",
            "Distribute hateful, violent, harassing, or adult content that violates Connected Platform policies;",
            "Spam or otherwise abuse the automatic scheduling system;",
            "Attempt to reverse-engineer, hack, or interfere with the security of the Service;",
            "Violate the Terms of Service of any Connected Platform (e.g., YouTube's Terms of Service).",
          ]},
        ],
      },
      {
        heading: "9. Kelolako's Intellectual Property",
        blocks: [
          { type: "p", text: "All rights to the Kelolako name, logo, interface, and software belong to Kelolako and are protected under applicable intellectual property law. You may not copy, modify, or redistribute Kelolako's software without written permission." },
        ],
      },
      {
        heading: "10. Suspension and Termination",
        blocks: [
          { type: "p", text: "Kelolako reserves the right to suspend or terminate your access to the Service at any time if you violate these Terms. You may stop using the Service and request deletion of your account at any time by contacting us via the contact information in Section 13." },
        ],
      },
      {
        heading: "11. Disclaimers and Limitation of Liability",
        blocks: [
          { type: "p", text: "THE SERVICE IS PROVIDED \"AS IS\" WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS OR IMPLIED. TO THE EXTENT PERMITTED BY APPLICABLE LAW, KELOLAKO SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, OR CONSEQUENTIAL DAMAGES ARISING FROM USE OF THE SERVICE, INCLUDING BUT NOT LIMITED TO LOSS OF CONTENT, LOSS OF REVENUE, OR DISRUPTIONS TO CONNECTED PLATFORMS." },
        ],
      },
      {
        heading: "12. Indemnification and Changes to Terms",
        blocks: [
          { type: "p", text: "You agree to defend, indemnify, and hold harmless Kelolako from any third-party claims, losses, or demands arising from your use of the Service or your violation of these Terms." },
          { type: "p", text: "Kelolako may update these Terms from time to time. Material changes will be notified via email or in-app notice. Continued use of the Service after changes take effect constitutes your acceptance of the updated Terms." },
        ],
      },
      {
        heading: "13. Governing Law and Contact",
        blocks: [
          { type: "p", text: "These Terms are governed by and construed in accordance with the laws of the Republic of Indonesia, with legal domicile in West Jakarta, DKI Jakarta." },
          { type: "p", text: "If you have questions about these Terms, please contact us at: krakatoateams@gmail.com" },
        ],
      },
    ],
  },
};

export default function TermsPage() {
  return <LegalPage content={content} />;
}
