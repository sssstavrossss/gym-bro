using System.Globalization;
using System.IO.Compression;
using System.Text;
using System.Text.Json;

namespace GymBro.Api.Export;

/// <summary>Writes the export tables as a zip: one CSV per table and <c>gym-bro.json</c> with all of them.</summary>
public static class ExportFiles
{
    public const string JsonName = "gym-bro.json";

    /// <summary>The download's name, dated in the person's own today.</summary>
    public static string ZipName(DateOnly today) => $"gym-bro-export-{today:yyyy-MM-dd}.zip";

    public static byte[] Zip(IReadOnlyList<ExportTable> tables, DateTimeOffset exportedAt)
    {
        using var buffer = new MemoryStream();
        using (var zip = new ZipArchive(buffer, ZipArchiveMode.Create, leaveOpen: true))
        {
            foreach (var table in tables)
            {
                Add(zip, table.Name.Replace('_', '-') + ".csv", Csv(table), exportedAt);
            }

            Add(zip, JsonName, Json(tables, exportedAt), exportedAt);
        }

        return buffer.ToArray();
    }

    private static void Add(ZipArchive zip, string name, byte[] content, DateTimeOffset at)
    {
        var entry = zip.CreateEntry(name, CompressionLevel.Optimal);
        entry.LastWriteTime = at;
        using var stream = entry.Open();
        stream.Write(content);
    }

    /// <summary>RFC 4180 CSV in UTF-8 with a byte order mark, so a spreadsheet reads æ, ø and å.
    /// Numbers use a point. Booleans are true and false. An empty cell is an unknown value.</summary>
    public static byte[] Csv(ExportTable table)
    {
        var text = new StringBuilder();
        text.AppendJoin(',', table.Columns.Select(Quote)).Append("\r\n");
        foreach (var row in table.Rows)
        {
            text.AppendJoin(',', row.Select(CsvCell)).Append("\r\n");
        }

        return [.. Encoding.UTF8.GetPreamble(), .. Encoding.UTF8.GetBytes(text.ToString())];
    }

    private static string CsvCell(object? value) => value switch
    {
        null => "",
        string text => Quote(Defused(text)),
        _ => Plain(value),
    };

    /// <summary>A name from a label or Open Food Facts that starts like a formula (=, +, -, @) would run in a
    /// spreadsheet. A leading apostrophe keeps it as text. The JSON file keeps the name as it was.</summary>
    public static string Defused(string text) =>
        text.Length > 0 && text[0] is '=' or '+' or '-' or '@' or '\t' or '\r' ? "'" + text : text;

    private static string Quote(string text) =>
        text.IndexOfAny([',', '"', '\r', '\n']) < 0 ? text : "\"" + text.Replace("\"", "\"\"") + "\"";

    private static string Plain(object value) => value switch
    {
        decimal number => Number(number),
        int number => number.ToString(CultureInfo.InvariantCulture),
        bool flag => flag ? "true" : "false",
        DateOnly date => date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        _ => Convert.ToString(value, CultureInfo.InvariantCulture) ?? "",
    };

    /// <summary>A stored 83.60 reads 83.6, and 100.00 reads 100.</summary>
    private static string Number(decimal value) => value.ToString("0.############", CultureInfo.InvariantCulture);

    public static byte[] Json(IReadOnlyList<ExportTable> tables, DateTimeOffset exportedAt)
    {
        using var buffer = new MemoryStream();
        using (var json = new Utf8JsonWriter(buffer, new JsonWriterOptions { Indented = true }))
        {
            json.WriteStartObject();
            json.WriteString("exported_at", exportedAt.ToString("O", CultureInfo.InvariantCulture));
            foreach (var table in tables)
            {
                json.WritePropertyName(table.Name);
                if (table.Single)
                {
                    if (table.Rows.Count == 0) json.WriteNullValue();
                    else WriteRow(json, table.Columns, table.Rows[0]);
                    continue;
                }

                json.WriteStartArray();
                foreach (var row in table.Rows)
                {
                    WriteRow(json, table.Columns, row);
                }

                json.WriteEndArray();
            }

            json.WriteEndObject();
        }

        return buffer.ToArray();
    }

    private static void WriteRow(Utf8JsonWriter json, IReadOnlyList<string> columns, object?[] row)
    {
        json.WriteStartObject();
        for (var i = 0; i < columns.Count; i++)
        {
            json.WritePropertyName(columns[i]);
            switch (row[i])
            {
                case null: json.WriteNullValue(); break;
                case string text: json.WriteStringValue(text); break;
                case bool flag: json.WriteBooleanValue(flag); break;
                case int number: json.WriteNumberValue(number); break;
                case decimal number: json.WriteRawValue(Number(number)); break;
                case DateOnly date: json.WriteStringValue(date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)); break;
                default: json.WriteStringValue(Convert.ToString(row[i], CultureInfo.InvariantCulture)); break;
            }
        }

        json.WriteEndObject();
    }
}
