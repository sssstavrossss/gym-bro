namespace GymBro.Api.Foods;

/// <summary>Tab-separated values with quotes, escaped quotes, and newlines inside quotes.</summary>
public static class QuotedTsv
{
    public readonly record struct Row(IReadOnlyList<string> Fields, bool Incomplete);

    public static IEnumerable<Row> Read(TextReader reader)
    {
        while (true)
        {
            var row = ReadRow(reader);
            if (row is null)
            {
                yield break;
            }

            yield return row.Value;
            if (row.Value.Incomplete)
            {
                yield break;
            }
        }
    }

    private static Row? ReadRow(TextReader reader)
    {
        var fields = new List<string>();
        var field = new System.Text.StringBuilder();
        var inQuotes = false;
        var any = false;
        while (reader.Read() is int raw && raw >= 0)
        {
            any = true;
            var ch = (char)raw;
            if (inQuotes)
            {
                if (ch == '"')
                {
                    if (reader.Peek() == '"')
                    {
                        reader.Read();
                        field.Append('"');
                    }
                    else
                    {
                        inQuotes = false;
                    }
                }
                else
                {
                    field.Append(ch);
                }

                continue;
            }

            if (ch == '"' && field.Length == 0)
            {
                inQuotes = true;
            }
            else if (ch == '\t')
            {
                fields.Add(field.ToString());
                field.Clear();
            }
            else if (ch == '\n')
            {
                fields.Add(field.ToString());
                return new Row(fields, false);
            }
            else if (ch == '\r')
            {
                if (reader.Peek() == '\n')
                {
                    reader.Read();
                }

                fields.Add(field.ToString());
                return new Row(fields, false);
            }
            else
            {
                field.Append(ch);
            }
        }

        if (!any)
        {
            return null;
        }

        fields.Add(field.ToString());
        return new Row(fields, inQuotes);
    }
}
