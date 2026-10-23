using System.Security.Claims;
using System.Text.Json;
using GymBro.Api.Auth;
using GymBro.Api.Configuration;

namespace GymBro.Api.Tests;

public sealed class ClaimsReaderTests
{
    [Fact]
    public void Object_id_comes_from_oid_not_sub()
    {
        var user = Principal(
            new Claim("sub", "pairwise-subject"),
            new Claim("oid", "object-id"));

        Assert.Equal("object-id", ClaimsReader.ObjectId(user));
    }

    [Fact]
    public void Object_id_accepts_the_long_claim_type()
    {
        var user = Principal(new Claim(
            "http://schemas.microsoft.com/identity/claims/objectidentifier",
            "object-id"));

        Assert.Equal("object-id", ClaimsReader.ObjectId(user));
    }

    [Fact]
    public void Email_prefers_the_email_claim_then_a_username_that_looks_like_one()
    {
        var fromEmail = Principal(
            new Claim("email", "a@example.com"),
            new Claim("preferred_username", "b@example.com"));
        Assert.Equal("a@example.com", ClaimsReader.Email(fromEmail));

        var fromUsername = Principal(new Claim("preferred_username", "c@example.com"));
        Assert.Equal("c@example.com", ClaimsReader.Email(fromUsername));

        var notAnEmail = Principal(new Claim("preferred_username", "not-an-email"));
        Assert.Null(ClaimsReader.Email(notAnEmail));
    }

    [Fact]
    public void Email_reads_a_json_array_claim()
    {
        var user = Principal(new Claim("emails", JsonSerializer.Serialize(new[] { "d@example.com", "e@example.com" })));

        Assert.Equal("d@example.com", ClaimsReader.Email(user));
    }

    [Fact]
    public void Display_name_falls_back_to_given_and_family_name()
    {
        var user = Principal(
            new Claim("given_name", "Alex"),
            new Claim("family_name", "Rivera"));

        Assert.Equal("Alex Rivera", ClaimsReader.DisplayName(user));
    }

    private static ClaimsPrincipal Principal(params Claim[] claims) =>
        new(new ClaimsIdentity(claims, authenticationType: "Test"));
}

public sealed class EnvFileTests
{
    [Fact]
    public void Parse_keeps_quotes_comments_and_hash_characters()
    {
        var parsed = EnvFile.Parse("""
            # comment
            export ENTRA_TENANT_SUBDOMAIN=contoso

            POSTGRES_PASSWORD="sekret#value"
            EMPTY=
            not a pair
            """);

        Assert.Equal("contoso", parsed["ENTRA_TENANT_SUBDOMAIN"]);
        Assert.Equal("sekret#value", parsed["POSTGRES_PASSWORD"]);
        Assert.Equal("", parsed["EMPTY"]);
        Assert.False(parsed.ContainsKey("not a pair"));
        Assert.False(parsed.ContainsKey("# comment"));
    }
}
