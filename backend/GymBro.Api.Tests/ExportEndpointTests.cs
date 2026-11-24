using System.IO.Compression;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using GymBro.Api.Export;

namespace GymBro.Api.Tests;

[Collection(ApiCollection.Name)]
public sealed class ExportEndpointTests(ApiFactory factory)
{
    [Fact]
    public async Task Export_is_a_zip_of_the_callers_own_data_as_csv_and_json()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 18, 0, 0, TimeSpan.Zero);
        var user = TestData.NewUser("export");
        using var client = factory.AsUser(user);
        await TestData.PutWeighIn(client, "2026-10-24", """{"kg":83.60,"timeZone":"UTC"}""");
        await TestData.PutProfile(client, TestData.Profile());

        var odd = await Food(client, "=Fictional, \"odd\" bar", 400, 20, 10, 50);
        var oats = await Food(client, "Fictional oats", 380, 13, 7, 60);
        Assert.Equal(HttpStatusCode.Created, (await client.PostAsJsonAsync("/api/foods/" + oats + "/servings", new { name = "bowl", grams = 60 })).StatusCode);
        var first = await Log(client, "a", $$"""{"foodId":"{{odd}}","amount":50,"unit":"g","time":"08:05"}""");
        var second = await Log(client, "b", $$"""{"foodId":"{{oats}}","amount":60,"unit":"g","time":"07:30"}""");
        var gone = await Log(client, "c", """{"name":"Fictional deleted snack","kcal":99,"protein":1,"fat":1,"carbs":1,"time":"12:00"}""");
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync("/api/log-entries/" + gone)).StatusCode);
        Assert.True((await client.PostAsync("/api/groups", Json($$"""{"name":"Fictional breakfast","entryIds":["{{second}}","{{first}}"]}"""))).IsSuccessStatusCode);
        Assert.True((await client.PostAsync("/api/recipes", Json($$"""{"name":"Fictional porridge","portions":2,"ingredients":[{"foodId":"{{oats}}","amount":120,"unit":"g"}]}"""))).IsSuccessStatusCode);
        Assert.True((await client.PutAsync("/api/day-status/2026-10-24", Json("""{"complete":false,"fasting":true,"timeZone":"UTC"}"""))).IsSuccessStatusCode);
        Assert.True((await client.PostAsJsonAsync("/api/describe", new { text = "60 g fictional oats" })).IsSuccessStatusCode);

        var stranger = TestData.NewUser("export-other");
        using var other = factory.AsUser(stranger);
        await TestData.PutWeighIn(other, "2026-10-24", """{"kg":70,"timeZone":"UTC"}""");
        await TestData.PutProfile(other, TestData.Profile());
        await Food(other, "Fictional stranger food", 100, 1, 1, 1);
        await Log(other, "x", """{"name":"Fictional stranger lunch","kcal":500,"protein":1,"fat":1,"carbs":1,"time":"12:00"}""");
        await other.PostAsJsonAsync("/api/describe", new { text = "a stranger sandwich" });

        var response = await client.GetAsync("/api/export");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/zip", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal("gym-bro-export-2026-10-24.zip", response.Content.Headers.ContentDisposition?.FileNameStar ?? response.Content.Headers.ContentDisposition?.FileName);
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());

        using var zip = new ZipArchive(await response.Content.ReadAsStreamAsync(), ZipArchiveMode.Read);
        Assert.Equal(
            ["profile.csv", "weigh-ins.csv", "targets.csv", "log.csv", "fasting-days.csv", "foods.csv", "servings.csv", "recipes.csv", "groups.csv", "descriptions.csv", ExportFiles.JsonName],
            zip.Entries.Select(entry => entry.FullName));
        Assert.Equal(
            ["created_at,kind,text,photo,outcome,foods,kcal,logged_at,model,input_tokens,output_tokens", "2026-10-24T18:00:00.0000000+00:00,meal,60 g fictional oats,false,found,1,228,,rule,0,0"],
            Lines(zip, "descriptions.csv"));
        var everything = string.Concat(zip.Entries.Select(Read));
        Assert.DoesNotContain("stranger", everything);
        Assert.DoesNotContain("deleted snack", everything);

        var log = Lines(zip, "log.csv");
        Assert.StartsWith("date,time,name,source,amount,unit,grams,kcal,protein_g,fat_g,carbs_g,saturated_fat_g,sugars_g,fiber_g,salt_g,mono_fat_g,", log[0]);
        Assert.EndsWith(",iodine_ug,copper_mg", log[0]);
        Assert.Equal(3, log.Length);
        // In time order, and a name that looks like a formula is kept as text.
        Assert.StartsWith("2026-10-24,07:30,Fictional oats,custom,60,g,60,228,", log[1]);
        Assert.StartsWith("2026-10-24,08:05,\"'=Fictional, \"\"odd\"\" bar\",custom,50,g,50,200,", log[2]);

        Assert.Equal(["date,kg", "2026-10-24,83.6"], Lines(zip, "weigh-ins.csv"));
        Assert.Equal(["date", "2026-10-24"], Lines(zip, "fasting-days.csv"));
        Assert.Equal(["food,serving,grams", "Fictional oats,bowl,60"], Lines(zip, "servings.csv"));
        Assert.Equal(["group,position,item,amount,unit,grams,kcal,protein_g,fat_g,carbs_g,saturated_fat_g,sugars_g,fiber_g,salt_g",
            "Fictional breakfast,1,Fictional oats,60,g,60,228,7.8,4.2,36,,,,"], Lines(zip, "groups.csv")[..2]);
        Assert.StartsWith("Fictional porridge,2,,false,1,Fictional oats,120,g,120,456,", Lines(zip, "recipes.csv")[1]);
        Assert.Equal(3, Lines(zip, "foods.csv").Length);
        Assert.Equal(2, Lines(zip, "profile.csv").Length);
        Assert.StartsWith("2026-10-24,", Lines(zip, "targets.csv")[1]);
        // The byte order mark lets a spreadsheet read UTF-8.
        using (var stream = zip.GetEntry("log.csv")!.Open())
        {
            var head = new byte[3];
            stream.ReadExactly(head);
            Assert.Equal(Encoding.UTF8.GetPreamble(), head);
        }

        using var json = JsonDocument.Parse(Read(zip.GetEntry(ExportFiles.JsonName)!));
        var root = json.RootElement;
        Assert.Equal("male", root.GetProperty("profile").GetProperty("sex").GetString());
        Assert.Equal(83.6m, root.GetProperty("weigh_ins")[0].GetProperty("kg").GetDecimal());
        var entries = root.GetProperty("log");
        Assert.Equal(2, entries.GetArrayLength());
        Assert.Equal("=Fictional, \"odd\" bar", entries[1].GetProperty("name").GetString());
        Assert.Equal(JsonValueKind.Null, entries[1].GetProperty("vitamin_a_ug").ValueKind);
        Assert.Equal(2, root.GetProperty("foods").GetArrayLength());
        Assert.False(root.GetProperty("foods")[0].GetProperty("retired").GetBoolean());
    }

    [Fact]
    public async Task Export_before_setup_has_empty_tables_and_no_profile()
    {
        factory.Clock.UtcNow = new DateTimeOffset(2026, 10, 24, 23, 30, 0, TimeSpan.Zero);
        using var client = factory.AsUser(TestData.NewUser("export-new"));
        var response = await client.GetAsync("/api/export");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var zip = new ZipArchive(await response.Content.ReadAsStreamAsync(), ZipArchiveMode.Read);
        Assert.Equal(["date,kg"], Lines(zip, "weigh-ins.csv"));
        using var json = JsonDocument.Parse(Read(zip.GetEntry(ExportFiles.JsonName)!));
        Assert.Equal(JsonValueKind.Null, json.RootElement.GetProperty("profile").ValueKind);
        Assert.Equal(0, json.RootElement.GetProperty("log").GetArrayLength());
    }

    [Theory]
    [InlineData("=1+1", "'=1+1")]
    [InlineData("-5 kcal bar", "'-5 kcal bar")]
    [InlineData("@home", "'@home")]
    [InlineData("Oats", "Oats")]
    [InlineData("", "")]
    public void Formula_like_text_gets_an_apostrophe(string text, string expected) => Assert.Equal(expected, ExportFiles.Defused(text));

    private static string Read(ZipArchiveEntry entry)
    {
        using var reader = new StreamReader(entry.Open(), Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
        return reader.ReadToEnd();
    }

    private static string[] Lines(ZipArchive zip, string name) =>
        Read(zip.GetEntry(name)!).Split("\r\n", StringSplitOptions.RemoveEmptyEntries);

    private static async Task<Guid> Food(HttpClient client, string name, decimal kcal, decimal protein, decimal fat, decimal carbs)
    {
        var response = await client.PostAsJsonAsync("/api/foods", new
        {
            name,
            kcalPer100 = kcal,
            proteinPer100 = protein,
            fatPer100 = fat,
            carbsPer100 = carbs,
            basis = "g",
            nutrientBasis = "per_100",
        });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
    }

    private static async Task<Guid> Log(HttpClient client, string key, string fields)
    {
        var body = fields.TrimEnd('}') + $$""","idempotencyKey":"{{key}}","localDate":"2026-10-24","timeZone":"UTC"}""";
        var response = await client.PostAsync("/api/log-entries", Json(body));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
    }

    private static StringContent Json(string json) => new(json, Encoding.UTF8, "application/json");
}
