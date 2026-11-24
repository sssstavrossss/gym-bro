using System.Text.Json;
using Anthropic;
using Anthropic.Models.Messages;
using Microsoft.Extensions.Options;

namespace GymBro.Api.Describe;

/// <summary>
/// One question to Claude with structured output, so the reply is JSON that matches a schema. Effort is low:
/// Describe's questions and reading a label are short lookups, not reasoning tasks. Shared by
/// <see cref="ClaudeMealModel"/> and <see cref="ClaudeLabelModel"/>.
/// </summary>
public sealed class ClaudeAsk(IOptions<DescribeOptions> options, ILogger<ClaudeAsk> logger)
{
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(30);

    // Made on first use, so a server without a key never builds a client.
    private readonly Lazy<AnthropicClient> client = new(() => new AnthropicClient { ApiKey = options.Value.ApiKey });

    public string Model => options.Value.Model;

    /// <remarks>Adds what the call cost to <paramref name="usage"/>, even when the answer is then refused or cut off.</remarks>
    public async Task<JsonElement> AskAsync(
        string system,
        MessageContentParam user,
        Dictionary<string, JsonElement> schema,
        int maxTokens,
        MealUsage usage,
        CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(Timeout);
        Message response;
        try
        {
            response = await client.Value.Messages.Create(
                new MessageCreateParams
                {
                    Model = options.Value.Model,
                    MaxTokens = maxTokens,
                    System = system,
                    Messages = [new UserMessageParam { Content = user }],
                    OutputConfig = new OutputConfig
                    {
                        Effort = Effort.Low,
                        Format = new JsonOutputFormat { Schema = schema },
                    },
                },
                timeout.Token);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Claude call failed");
            throw new MealModelException("Claude didn't answer.", inner: ex);
        }

        usage.Add(response.Usage.InputTokens, response.Usage.OutputTokens);
        if (response.StopReason == "refusal")
        {
            throw new MealModelException("Claude declined.", refused: true);
        }

        var text = string.Concat(response.Content.Select(block => block.Value).OfType<TextBlock>().Select(block => block.Text));
        try
        {
            using var document = JsonDocument.Parse(text);
            return document.RootElement.Clone();
        }
        catch (JsonException ex)
        {
            // A reply cut off at max tokens is not valid JSON.
            logger.LogWarning("Claude's reply was not JSON (stop reason {StopReason})", response.StopReason);
            throw new MealModelException("Claude's answer was cut off.", inner: ex);
        }
    }

    /// <summary>A JSON schema, written as JSON, in the form the SDK takes.</summary>
    public static Dictionary<string, JsonElement> Schema(string json)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.EnumerateObject().ToDictionary(property => property.Name, property => property.Value.Clone());
    }

    /// <summary>A photo as an image block.</summary>
    public static ImageBlockParam Image(MealPhoto photo) => new()
    {
        Source = new Base64ImageSource { Data = Convert.ToBase64String(photo.Data), MediaType = photo.MediaType },
    };
}
