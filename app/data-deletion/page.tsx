import type { Metadata } from "next";
import { LegalPage, type LegalContent } from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "Instruksi Penghapusan Data / Data Deletion Instructions — Kelolako",
  robots: "noindex",
};

const content: LegalContent = {
  indonesian: {
    pageTitle: "Instruksi Penghapusan Data",
    effectiveDate: "Terakhir diperbarui: 9 Juli 2026",
    intro: "Halaman ini menjelaskan cara meminta penghapusan data pribadi Anda dari Kelolako, termasuk data yang terhubung melalui login Facebook/Instagram.",
    sections: [
      {
        heading: "1. Cara Meminta Penghapusan Data",
        blocks: [
          { type: "p", text: "Anda dapat meminta penghapusan seluruh data akun Anda dari Kelolako dengan mengirim email ke krakatoateams@gmail.com dengan subjek \"Permintaan Penghapusan Data\" dan menyertakan alamat email akun Anda." },
        ],
      },
      {
        heading: "2. Apa yang Akan Dihapus",
        blocks: [
          { type: "p", text: "Setelah permintaan diverifikasi, kami akan menghapus:" },
          { type: "ul", items: [
            "Informasi akun (email, nama, foto profil);",
            "Konten yang Anda unggah (video, foto);",
            "Token otorisasi platform terhubung (YouTube, Instagram, TikTok);",
            "Riwayat transaksi kredit.",
          ]},
        ],
      },
      {
        heading: "3. Waktu Proses",
        blocks: [
          { type: "p", text: "Permintaan penghapusan data akan diproses dalam 14 hari kerja sejak verifikasi identitas berhasil." },
        ],
      },
      {
        heading: "4. Memutuskan Koneksi Instagram Secara Mandiri",
        blocks: [
          { type: "p", text: "Jika Anda hanya ingin memutuskan koneksi akun Instagram Anda (tanpa menghapus seluruh akun Kelolako), Anda dapat melakukannya kapan saja melalui Pengaturan → Connections → Disconnect di dalam aplikasi Kelolako. Ini akan langsung menghapus token otorisasi Instagram dari sistem kami." },
        ],
      },
    ],
  },
  english: {
    pageTitle: "Data Deletion Instructions",
    effectiveDate: "Last updated: July 9, 2026",
    intro: "This page explains how to request deletion of your personal data from Kelolako, including data connected via Facebook/Instagram login.",
    sections: [
      {
        heading: "1. How to Request Data Deletion",
        blocks: [
          { type: "p", text: "You may request deletion of all your Kelolako account data by emailing krakatoateams@gmail.com with the subject \"Data Deletion Request\" and including your account's email address." },
        ],
      },
      {
        heading: "2. What Will Be Deleted",
        blocks: [
          { type: "p", text: "Upon verification, we will delete:" },
          { type: "ul", items: [
            "Account information (email, name, profile photo);",
            "Content you've uploaded (videos, photos);",
            "Connected platform authorization tokens (YouTube, Instagram, TikTok);",
            "Credit transaction history.",
          ]},
        ],
      },
      {
        heading: "3. Processing Time",
        blocks: [
          { type: "p", text: "Data deletion requests are processed within 14 business days of successful identity verification." },
        ],
      },
      {
        heading: "4. Self-Service Instagram Disconnect",
        blocks: [
          { type: "p", text: "If you only want to disconnect your Instagram account (without deleting your entire Kelolako account), you can do so anytime via Settings → Connections → Disconnect within the Kelolako app. This immediately removes the Instagram authorization token from our system." },
        ],
      },
    ],
  },
};

export default function DataDeletionPage() {
  return <LegalPage content={content} />;
}
