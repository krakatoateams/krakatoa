import type { Metadata } from "next";
import { LegalPage, type LegalContent } from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "Instruksi Penghapusan Data / Data Deletion Instructions — Kelolako",
  robots: "noindex",
};

const content: LegalContent = {
  indonesian: {
    pageTitle: "Instruksi Penghapusan Data",
    effectiveDate: "Terakhir diperbarui: 13 September 2026",
    intro: "Halaman ini menjelaskan cara meminta penghapusan data pribadi Anda dari Kelolako, termasuk data yang terhubung melalui platform yang Anda hubungkan, seperti YouTube, TikTok, dan Instagram.",
    sections: [
      {
        heading: "1. Cara Meminta Penghapusan Data",
        blocks: [
          { type: "p", text: "Anda dapat meminta penghapusan seluruh data akun Anda dari Kelolako dengan mengirim email ke support@kelolako.com dengan subjek \"Permintaan Penghapusan Data\" dan menyertakan alamat email akun Anda." },
        ],
      },
      {
        heading: "2. Apa yang Akan Dihapus",
        blocks: [
          { type: "p", text: "Setelah permintaan diverifikasi, kami akan menghapus:" },
          { type: "ul", items: [
            "Informasi akun (email, nama, foto profil);",
            "Konten yang Anda unggah maupun yang dihasilkan melalui fitur AI kami (video, foto, caption);",
            "Token otorisasi platform terhubung (YouTube, TikTok, dan Instagram);",
            "Riwayat transaksi kredit.",
          ]},
          { type: "p", text: "Catatan: data transaksi yang tersimpan di sistem penyedia pembayaran kami (saat ini DOKU, atau penyedia lain yang kami gunakan di masa mendatang) tunduk pada kebijakan retensi dan hukum mereka masing-masing, dan mungkin tidak terhapus sepenuhnya melalui permintaan ini." },
          { type: "p", text: "Penghapusan token Instagram mencakup token akses yang disimpan untuk akun Instagram Business/Creator yang pernah Anda hubungkan." },
        ],
      },
      {
        heading: "3. Waktu Proses",
        blocks: [
          { type: "p", text: "Permintaan penghapusan data akan diproses dalam 14 hari kerja sejak verifikasi identitas berhasil." },
        ],
      },
      {
        heading: "4. Memutuskan Koneksi Platform Terhubung Secara Mandiri",
        blocks: [
          { type: "p", text: "Jika Anda hanya ingin memutuskan koneksi salah satu platform terhubung Anda (tanpa menghapus seluruh akun Kelolako), Anda dapat melakukannya kapan saja melalui Pengaturan → Connections → Disconnect di dalam aplikasi Kelolako. Ini berlaku untuk YouTube, TikTok, dan Instagram, dan akan menghapus token otorisasi platform terkait dari sistem kami." },
        ],
      },
    ],
  },
  english: {
    pageTitle: "Data Deletion Instructions",
    effectiveDate: "Last updated: September 13, 2026",
    intro: "This page explains how to request deletion of your personal data from Kelolako, including data connected via platforms you've linked, such as YouTube, TikTok, and Instagram.",
    sections: [
      {
        heading: "1. How to Request Data Deletion",
        blocks: [
          { type: "p", text: "You may request deletion of all your Kelolako account data by emailing support@kelolako.com with the subject \"Data Deletion Request\" and including your account's email address." },
        ],
      },
      {
        heading: "2. What Will Be Deleted",
        blocks: [
          { type: "p", text: "Upon verification, we will delete:" },
          { type: "ul", items: [
            "Account information (email, name, profile photo);",
            "Content you've uploaded as well as content generated through our AI features (videos, photos, captions);",
            "Authorization tokens for connected platforms (YouTube, TikTok, and Instagram);",
            "Credit transaction history.",
          ]},
          { type: "p", text: "Note: transaction data held by our payment provider(s) (currently DOKU, or any additional providers we may use in the future) is subject to their own retention policies and applicable regulations, and may not be fully deleted through this request." },
          { type: "p", text: "Deleting Instagram tokens includes the access token stored for any Instagram Business/Creator account you previously connected." },
        ],
      },
      {
        heading: "3. Processing Time",
        blocks: [
          { type: "p", text: "Data deletion requests are processed within 14 business days of successful identity verification." },
        ],
      },
      {
        heading: "4. Self-Service Disconnect for Connected Platforms",
        blocks: [
          { type: "p", text: "If you only want to disconnect one of your connected platforms (without deleting your entire Kelolako account), you can do so anytime via Settings → Connections → Disconnect within the Kelolako app. This applies to YouTube, TikTok, and Instagram, and removes the relevant platform authorization token from our system." },
        ],
      },
    ],
  },
};

export default function DataDeletionPage() {
  return <LegalPage content={content} />;
}
