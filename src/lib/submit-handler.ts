import * as cheerio from "cheerio";
import PostalMime from "postal-mime";
import { toast } from "sonner";

import { z } from "zod";

// Dibawah ini adalah variabel keramat yang mengendalikan
// validasi dan kemutakhiran data, dimohon untuk melakukan
// pembaruan angka sesuai kondisi yang terjadi di lapangan.
export const CURRENT_SEMESTER = 124;

const headerScheme = z.object({
  "snapshot-content-location": z.string().url(),
  subject: z.string(),
});

const studentInfoScheme = z.object({
  nim: z.string(),
  name: z.string(),
  major: z.string(),
  faculty: z.string(),
  generation: z.string(),
});

export const studentStudies = z.array(
  z.object({
    dayIndex: z.number(),
    day: z.string(),
    subjects: z.array(
      z.object({
        subject: z.string(),
        lecturer: z.string(),
        time: z.object({
          round: z.string(),
          startedAt: z.string(),
          endedAt: z.string(),
        }),
        location: z.object({
          building: z.string().nullable(),
          roomNumber: z.string().nullable(),
        }),
      })
    ),
    startsAt: z.string(),
    endsAt: z.string(),
  })
);

const timeToNumber = (t: string) => parseInt(t.replaceAll(":", ""));
const DAYTIME_REF = [
  { label: "Senin", idx: 0 },
  { label: "Selasa", idx: 1 },
  { label: "Rabu", idx: 2 },
  { label: "Kamis", idx: 3 },
  { label: "Jum'at", idx: 4 },
];

const trimSplitAndTrim = (content: string) =>
  content
    .trim()
    .split(/\r?\n/)
    .map((c) => c.trim());

interface IGreedArray {
  subject: string;
  lecturer: string;
  location: {
    building: string | null;
    roomNumber: string | null;
  };
  time: {
    day: string;
    round: string;
    startedAt: string;
    endedAt: string;
  };
}

export const onSubmit =
  (
    successCallback: (successData: {
      studies: z.infer<typeof studentStudies>;
      studentInfo: z.infer<typeof studentInfoScheme>;
    }) => void
  ) =>
  async (formData: { krs: FileList }) => {
    try {
      let tempGreedArray: IGreedArray[] = [];

      const fileKRS = formData.krs.item(0)!;
      const raw = await fileKRS.text();

      const content = await PostalMime.parse(raw);

      const objectifyHeader = content.headers.reduce((acc, currentObject) => {
        acc[currentObject.key] = currentObject.value;
        return acc;
      }, {});

      const validateHeader = await headerScheme.safeParseAsync(objectifyHeader);

      if (!validateHeader.success)
        return toast.error("Gagal membaca file.", {
          description: "Format file tidak sesuai!",
        });

      if (
        validateHeader.data["snapshot-content-location"] !==
          "https://siakad.unj.ac.id/index.php/krs" ||
        validateHeader.data.subject !== "Siakad UNJ"
      )
        return toast.error("Gagal membaca file.", {
          description:
            "Informasi KRS yang dicantukmkan tidak berasal dari Siakad UNJ!",
        });

      if (!content.html)
        return toast.error("File sudah dimodifikasi.", {
          description:
            "File yang anda pilih tidak memiliki konten html, mohon unduh kembali dari web siakad.",
        });

      const $ = cheerio.load(content.html);

      const studentInfoValidation = await studentInfoScheme.safeParseAsync({
        nim: $(".profile-user-info:nth-of-type(1) .profile-info-value")
          .text()
          .trim(),
        name: $(".profile-user-info:nth-of-type(2) .profile-info-value")
          .text()
          .trim(),
        major: $(".profile-user-info:nth-of-type(3) .profile-info-value")
          .text()
          .trim(),
        faculty: $(".profile-user-info:nth-of-type(4) .profile-info-value")
          .text()
          .trim(),
        generation: $(".profile-user-info:nth-of-type(5) .profile-info-value")
          .text()
          .trim(),
      });

      if (!studentInfoValidation.success)
        return toast.error("Informasi mahasiswa kosong", {
          description:
            "File yang anda pilih memiliki masalah dengan identitas yang tidak tercantum. Mohon cek kembali web siakad dan file unduhan anda.",
        });

      const truthTable = $("table#dynamic-table");

      if (truthTable.length === 0)
        return toast.error("Tidak ada tabel mata kuliah.", {
          description:
            "Anda belum memilih data semester! Pilih semester terlebih dahulu dan ulangi proses unduhnya.",
        });

      const rawSemesterIndicator = $(
        "#showingData .widget-header .widget-title"
      ).text();

      if (!rawSemesterIndicator.startsWith("Daftar Rencana Studi Semester : "))
        return toast.error("Tidak dapat memastikan informasi semester", {
          description:
            "Mohon untuk mengunduh informasi KRS anda kembali. Jika masih bermasalah, hubungi pembuat web ini.",
        });

      const currentDataSemester = parseInt(
        rawSemesterIndicator
          .replace("Daftar Rencana Studi Semester : ", "")
          .trim()
      );

      if (currentDataSemester !== CURRENT_SEMESTER)
        return toast.error(`Data harus semester ${CURRENT_SEMESTER}`, {
          description: `Saat ini UNJ berada di semester ${CURRENT_SEMESTER}, namun data KRS menunjukan pada semester ${currentDataSemester}. Mohon unduh data terbaru.`,
        });

      const tableBodyTr = [...truthTable.find("tbody tr").clone()];
      tableBodyTr.pop();

      if (tableBodyTr.length < 1)
        return toast.error("KRS anda masih kosong.", {
          description: "Mohon diisi terlebih dahulu.",
        });

      if (tableBodyTr.every((el) => el.name !== "tr"))
        return toast.error("Kesalahan program web", {
          description:
            "Ada kesalahan membaca baris perbaris data mata kuliah dari tabel. Mohon hubungi pemilik web ini.",
        });

      tableBodyTr.forEach((tr) => {
        const allTds = [
          ...$(tr)
            .children()
            .filter((_, el) => el.name === "td"),
        ];

        const currentRowData = {
          subject: $(allTds[3]).text().trim(),
          lecturer: $(allTds[5])
            .text()
            .trim()
            .split(/\r?\n/)
            .map((d) => d.trim())
            .join(", "),
          location: trimSplitAndTrim($(allTds[6]).text()),
          time: trimSplitAndTrim($(allTds[7]).text()),
        };

        const preciseLocationInfo = currentRowData.location.map((loc) => {
          const [building, roomNumber] = loc.split(" Ruang : ");

          return {
            building: building !== "Ruang :" ? building : null,
            roomNumber: roomNumber ?? null,
          };
        });

        const preciseTimeInfo = currentRowData.time.map((t) => {
          const [day, needToSplit] = t.split(", Waktu : ");
          const [round, timing] = needToSplit.replace(")", "").split(" (");

          const [startedAt, endedAt] = timing.split(" sd ");

          return {
            day,
            round: round.replace("Jam ", ""),
            startedAt,
            endedAt,
          };
        });

        if (preciseLocationInfo.length !== preciseTimeInfo.length) {
          toast.error(
            "Jumlah data lokasi tidak sama dengan jumlah data waktu",
            {
              description:
                "Hal ini harusnya tidak terjadi karena mengikuti dengan jumlah SKS. Jika anda tidak mengubah file secara manual, hubungi pembuat web ini.",
            }
          );

          throw new Error("Stop, stop, stop. Space n Time mismatch!");
        }

        for (let i = 0; i < preciseLocationInfo.length; i++) {
          tempGreedArray.push({
            ...currentRowData,
            location: preciseLocationInfo.at(i)!,
            time: preciseTimeInfo.at(i)!,
          });
        }
      });

      const restructureData = DAYTIME_REF.map((daytime) => {
        const currentDaySubjects = tempGreedArray
          .filter((d) => d.time.day === daytime.label)
          .sort(
            (a, b) =>
              timeToNumber(a.time.startedAt) - timeToNumber(b.time.endedAt)
          )
          .map((s) => ({
            ...s,
            time: {
              round: s.time.round,
              startedAt: s.time.startedAt,
              endedAt: s.time.endedAt,
            },
          }));

        const startsAt = currentDaySubjects.at(0)?.time.startedAt ?? null;
        const endsAt =
          currentDaySubjects.at(currentDaySubjects.length - 1)?.time.endedAt ??
          null;

        return {
          dayIndex: daytime.idx,
          day: daytime.label,
          subjects: currentDaySubjects,
          startsAt,
          endsAt,
        };
      })
        .filter((d) => d.startsAt !== null)
        .filter((d) => d.endsAt !== null);

      const validateRestructuredData = await studentStudies.safeParseAsync(
        restructureData
      );

      if (!validateRestructuredData.success)
        return toast.error(
          "Ada data yang tidak valid sebelum proses finishing.",
          {
            description:
              "Coba unduh data KRS lagi. Kalau masih bermasalah, hubungi pembuat web ini.",
          }
        );

      successCallback({
        studies: validateRestructuredData.data,
        studentInfo: studentInfoValidation.data,
      });
    } catch (e) {
      console.error(e);

      toast.error("Terjadi kegagalan membaca", {
        description:
          "Error ini terjadi karena ada kesalahan pemrograman. Mohon hubungi pembuat web ini untuk memperbaikinya.",
      });
    }
  };
